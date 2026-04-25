/**
 * Vapi Webhook Service
 *
 * Handles all business-logic side effects for incoming Vapi server events.
 * The route handler (POST /api/webhooks/vapi) deals with HTTP / auth; this
 * service deals with what to actually *do* for each event type.
 *
 * Events we act on:
 *
 *  status-update (status: "in-progress")
 *    Call is live.  Look up the call session by provider_session_id.
 *    If no session exists yet (tool call hasn't fired), create one now as a
 *    best-effort so we have a row to write events against.
 *
 *  status-update (status: "ended")
 *    Call is over.  Mark the session as ended (sets a flag in event_history).
 *    Image analysis is kicked off non-blocking for any photos attached to the job.
 *
 *  end-of-call-report
 *    Transcript is now available.  Write it to call_sessions.transcript, then
 *    fire the Call Summary Service to generate problem_summary.  Both are
 *    idempotent — replayed webhooks are safe.
 *
 *  conversation-update
 *    Incrementally update call_sessions.transcript with the latest full
 *    conversation text so the worker view stays live during a call.
 *    We write it as a rolling replace, not an append, because Vapi always
 *    sends the *full* history.
 *
 *  tool-calls
 *    Routed through the full tool-call dispatcher which handles all nine
 *    registered tools: create-call-session, check-form-status, classify-job,
 *    price-job, get-available-slots, hold-slot, create-payment-session,
 *    summarise-call, generate-intake-token.
 *    Returns the results array Vapi expects synchronously.
 *
 * Non-event-specific rules:
 *   - Every handler appends the raw event to call_sessions.event_history so
 *     we have a full audit trail.
 *   - Service errors are caught and returned as typed results — never thrown.
 *   - DB writes for analytics (event_history, transcript) never block the
 *     primary response path.
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { generateCallSummary } from "./call-summary-service";
import { analyseJobImages } from "./image-analysis-service";

// ─── Vapi payload types ───────────────────────────────────────────────────────
//
// Vapi sends:  POST body = { message: { type: "...", call: {...}, ... } }
//
// We define minimal typed shapes — only the fields we actually read.

export type VapiCallObject = {
  id: string; // Vapi's call ID — matches call_sessions.provider_session_id
  customer?: { number?: string };
  assistantId?: string;
};

/** Base shape every Vapi server message shares. */
export type VapiMessageBase = {
  type: string;
  call?: VapiCallObject;
  timestamp?: string;
};

export type VapiStatusUpdateMessage = VapiMessageBase & {
  type: "status-update";
  status: "scheduled" | "queued" | "ringing" | "in-progress" | "forwarding" | "ended";
};

export type VapiEndOfCallReportMessage = VapiMessageBase & {
  type: "end-of-call-report";
  endedReason?: string;
  artifact?: {
    transcript?: string;
    messages?: Array<{ role: string; message: string }>;
  };
};

export type VapiConversationUpdateMessage = VapiMessageBase & {
  type: "conversation-update";
  messages?: Array<{ role: string; message?: string; content?: string }>;
};

/** A single tool call inside a tool-calls message. */
export type VapiToolCall = {
  id: string;
  name: string;
  parameters?: Record<string, unknown>;
};

export type VapiToolCallsMessage = VapiMessageBase & {
  type: "tool-calls";
  toolCallList?: VapiToolCall[];
  toolWithToolCallList?: Array<{
    name: string;
    toolCall: {
      id: string;
      parameters?: Record<string, unknown>;
    };
  }>;
};

export type VapiMessage =
  | VapiStatusUpdateMessage
  | VapiEndOfCallReportMessage
  | VapiConversationUpdateMessage
  | VapiToolCallsMessage
  | VapiMessageBase; // catch-all for unknown types

/** The outermost Vapi request body shape. */
export type VapiWebhookBody = {
  message: VapiMessage;
};

// ─── Service result types ─────────────────────────────────────────────────────

/** For status-update and end-of-call-report: no synchronous response body needed. */
export type VapiEventResult =
  | { success: true; action: string }
  | { success: false; error: string; message: string };

/** For tool-calls: Vapi requires a synchronous results array. */
export type VapiToolCallResult = {
  toolCallId: string;
  result: string; // JSON string or plain text
};

export type VapiToolCallsResult =
  | { success: true; results: VapiToolCallResult[] }
  | { success: false; error: string; message: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Vapi conversation messages array into a plain text transcript
 * string in the format "Role: message\n".
 */
export function buildTranscriptText(
  messages: Array<{ role: string; message?: string; content?: string }>,
): string {
  return messages
    .map((m) => {
      const text = (m.message ?? m.content ?? "").trim();
      if (!text) return null;
      const role = m.role === "assistant" ? "Agent" : "Customer";
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Append a raw Vapi event object to call_sessions.event_history (jsonb[]).
 * Fire-and-forget — DB failures are swallowed to keep the audit trail from
 * ever blocking event handling.
 */
async function appendEventHistory(
  sessionId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const supabase = createSupabaseServiceClient();

  try {
    // Use Postgres array append function so we never overwrite existing items.
    // Supabase doesn't expose array_append directly from the client, so we
    // do a read-then-write instead.  This is fine for an audit trail column.
    const { data } = await supabase
      .from("call_sessions")
      .select("event_history")
      .eq("id", sessionId)
      .single();

    const existing: unknown[] = Array.isArray((data as { event_history?: unknown[] } | null)?.event_history)
      ? ((data as { event_history: unknown[] }).event_history)
      : [];

    await supabase
      .from("call_sessions")
      .update({
        event_history: [...existing, { ...event, _receivedAt: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  } catch {
    // Swallow — audit trail must never block event handling
  }
}

/**
 * Find a call session by Vapi call ID (provider_session_id).
 * Returns the session row or null.
 */
async function findSessionByCallId(vapiCallId: string): Promise<{
  id: string;
  job_id: string | null;
  transcript: string | null;
} | null> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("call_sessions")
    .select("id, job_id, transcript")
    .eq("provider_session_id", vapiCallId)
    .maybeSingle();

  return (data as { id: string; job_id: string | null; transcript: string | null } | null) ?? null;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Handle status-update: "in-progress"
 *
 * The call is now live.  If create-call-session tool hasn't run yet we have
 * no session row — we can still record the event gracefully.  Nothing blocks.
 */
export async function handleCallStarted(
  event: VapiStatusUpdateMessage,
): Promise<VapiEventResult> {
  const vapiCallId = event.call?.id;
  if (!vapiCallId) {
    return { success: false, error: "missing_call_id", message: "No call.id on status-update event." };
  }

  const session = await findSessionByCallId(vapiCallId);
  if (!session) {
    // Session not created yet — tool call may come shortly, nothing to do.
    console.log(`[vapi-webhook] status-update in-progress: no session for call ${vapiCallId} yet`);
    return { success: true, action: "no_session_yet" };
  }

  void appendEventHistory(session.id, event as unknown as Record<string, unknown>);
  console.log(`[vapi-webhook] status-update in-progress: session ${session.id}`);
  return { success: true, action: "call_started" };
}

/**
 * Handle status-update: "ended"
 *
 * Record the event.  Kick off non-blocking image analysis for any job photos.
 */
export async function handleCallEnded(
  event: VapiStatusUpdateMessage,
): Promise<VapiEventResult> {
  const vapiCallId = event.call?.id;
  if (!vapiCallId) {
    return { success: false, error: "missing_call_id", message: "No call.id on status-update event." };
  }

  const session = await findSessionByCallId(vapiCallId);
  if (!session) {
    console.log(`[vapi-webhook] status-update ended: no session for call ${vapiCallId}`);
    return { success: true, action: "no_session" };
  }

  void appendEventHistory(session.id, event as unknown as Record<string, unknown>);

  // Kick off image analysis non-blocking — must never gate on this
  if (session.job_id) {
    void analyseJobImages(session.job_id).then((result) => {
      console.log(
        `[vapi-webhook] image analysis for job ${session.job_id}: ` +
          `${result.analysed} analysed, ${result.skipped} skipped, ${result.failed} failed`,
      );
    });
  }

  console.log(`[vapi-webhook] status-update ended: session ${session.id}`);
  return { success: true, action: "call_ended" };
}

/**
 * Handle end-of-call-report
 *
 * Write the final transcript, then fire the Call Summary Service.
 * Both are idempotent — replay safe.
 */
export async function handleEndOfCallReport(
  event: VapiEndOfCallReportMessage,
): Promise<VapiEventResult> {
  const vapiCallId = event.call?.id;
  if (!vapiCallId) {
    return { success: false, error: "missing_call_id", message: "No call.id on end-of-call-report." };
  }

  const session = await findSessionByCallId(vapiCallId);
  if (!session) {
    console.log(`[vapi-webhook] end-of-call-report: no session for call ${vapiCallId}`);
    return { success: true, action: "no_session" };
  }

  const supabase = createSupabaseServiceClient();

  // 1. Build transcript text from messages array (prefer messages over plain transcript)
  let transcriptText: string | null = null;

  if (event.artifact?.messages && event.artifact.messages.length > 0) {
    transcriptText = buildTranscriptText(event.artifact.messages);
  } else if (event.artifact?.transcript) {
    transcriptText = event.artifact.transcript;
  }

  // 2. Write transcript to DB (only if we have something meaningful)
  if (transcriptText?.trim()) {
    await supabase
      .from("call_sessions")
      .update({
        transcript: transcriptText,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
  }

  void appendEventHistory(session.id, event as unknown as Record<string, unknown>);

  // 3. Fire Call Summary Service (idempotent)
  const summaryResult = await generateCallSummary(session.id);
  if (!summaryResult.success) {
    console.warn(
      `[vapi-webhook] generateCallSummary failed for session ${session.id}: ` +
        `${summaryResult.error} — ${summaryResult.message}`,
    );
    // Non-fatal: we still return success so Vapi doesn't retry
    return { success: true, action: "transcript_written_summary_skipped" };
  }

  console.log(
    `[vapi-webhook] end-of-call-report: session ${session.id}, ` +
      `summary ${summaryResult.alreadyDone ? "already existed" : "generated"}`,
  );
  return { success: true, action: summaryResult.alreadyDone ? "summary_already_done" : "summary_generated" };
}

/**
 * Handle conversation-update
 *
 * Write the current full conversation snapshot as a transcript so the worker
 * dashboard can see what's happening in real time.
 */
export async function handleConversationUpdate(
  event: VapiConversationUpdateMessage,
): Promise<VapiEventResult> {
  const vapiCallId = event.call?.id;
  if (!vapiCallId) {
    return { success: false, error: "missing_call_id", message: "No call.id on conversation-update." };
  }

  const session = await findSessionByCallId(vapiCallId);
  if (!session) {
    // Tool may not have run yet — ignore, not an error
    return { success: true, action: "no_session_yet" };
  }

  const messages = event.messages ?? [];
  if (messages.length === 0) {
    return { success: true, action: "no_messages" };
  }

  const transcriptText = buildTranscriptText(messages);
  if (!transcriptText.trim()) {
    return { success: true, action: "empty_transcript" };
  }

  const supabase = createSupabaseServiceClient();
  await supabase
    .from("call_sessions")
    .update({
      transcript: transcriptText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  return { success: true, action: "transcript_updated" };
}

/**
 * Handle tool-calls
 *
 * Dispatches to per-tool handlers and returns the results array Vapi expects.
 *
 * This is a minimal inline dispatcher.  Task 5 (tool-call dispatcher) will
 * expand this with the full tool set.  Here we handle the most critical tool
 * (create-call-session) inline so the endpoint is functional from day one.
 */
export async function handleToolCalls(
  event: VapiToolCallsMessage,
): Promise<VapiToolCallsResult> {
  const toolCalls: VapiToolCall[] =
    event.toolCallList ??
    (event.toolWithToolCallList?.map((t) => ({
      id: t.toolCall.id,
      name: t.name,
      parameters: t.toolCall.parameters,
    })) ?? []);

  if (toolCalls.length === 0) {
    return { success: false, error: "no_tool_calls", message: "toolCallList was empty." };
  }

  const results: VapiToolCallResult[] = await Promise.all(
    toolCalls.map((tc) => dispatchToolCall(tc, event)),
  );

  return { success: true, results };
}

/**
 * Resolve a jobId from either a direct `jobId` parameter or a `sessionId`.
 * Returns `{ jobId }` on success or `{ error, message }` on failure.
 */
async function resolveJobId(
  parameters: Record<string, unknown>,
): Promise<{ jobId: string } | { error: string; message: string }> {
  const directJobId = parameters.jobId as string | undefined;
  if (directJobId) return { jobId: directJobId };

  const sessionId = parameters.sessionId as string | undefined;
  if (!sessionId) {
    return { error: "bad_request", message: "Missing jobId or sessionId." };
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("call_sessions")
    .select("job_id")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    return { error: "not_found", message: `Call session not found: ${sessionId}` };
  }

  const jobId = (data as { job_id: string | null }).job_id;
  if (!jobId) {
    return { error: "not_found", message: `Call session ${sessionId} has no linked job yet.` };
  }

  return { jobId };
}

/**
 * Dispatch a single tool call.
 *
 * Returns a VapiToolCallResult whose `result` field is a JSON string.
 * Errors are returned as result payloads (not thrown) so Vapi can relay them
 * to the assistant as context.
 */
async function dispatchToolCall(
  toolCall: VapiToolCall,
  event: VapiToolCallsMessage,
): Promise<VapiToolCallResult> {
  const { id, name, parameters = {} } = toolCall;

  try {
    let resultPayload: Record<string, unknown>;

    switch (name) {
      // ── create-call-session ─────────────────────────────────────────────
      case "createCallSession":
      case "create-call-session": {
        const vapiCallId = (parameters.vapiCallId as string | undefined) ?? event.call?.id ?? "";
        const serviceBusinessId = parameters.serviceBusinessId as string | undefined;
        const phoneNumber =
          (parameters.phoneNumber as string | undefined) ??
          event.call?.customer?.number ??
          "";

        if (!vapiCallId || !serviceBusinessId || !phoneNumber) {
          resultPayload = {
            success: false,
            error: "bad_request",
            message: "Missing vapiCallId, serviceBusinessId, or phoneNumber.",
          };
          break;
        }

        const { createCallSessionFromVapi } = await import("./vapi-call-session");
        resultPayload = await createCallSessionFromVapi({ vapiCallId, serviceBusinessId, phoneNumber });
        break;
      }

      // ── check-form-status ───────────────────────────────────────────────
      case "checkFormStatus":
      case "check-form-status": {
        const sessionId = parameters.sessionId as string | undefined;
        const jobId = parameters.jobId as string | undefined;

        if (!sessionId && !jobId) {
          resultPayload = { success: false, error: "bad_request", message: "Missing sessionId or jobId." };
          break;
        }

        const supabase = createSupabaseServiceClient();
        let completedAt: string | null = null;
        let resolvedJobId: string | null = jobId ?? null;

        if (sessionId) {
          const { data, error } = await supabase
            .from("call_sessions")
            .select("intake_form_completed_at, job_id")
            .eq("id", sessionId)
            .single();
          if (error || !data) {
            resultPayload = { success: false, error: "not_found", message: `Call session not found: ${sessionId}` };
            break;
          }
          const row = data as { intake_form_completed_at: string | null; job_id: string | null };
          completedAt = row.intake_form_completed_at;
          resolvedJobId = row.job_id ?? resolvedJobId;
        } else if (jobId) {
          const { data } = await supabase
            .from("call_sessions")
            .select("intake_form_completed_at, job_id")
            .eq("job_id", jobId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const row = data as { intake_form_completed_at: string | null; job_id: string | null } | null;
          completedAt = row?.intake_form_completed_at ?? null;
          resolvedJobId = row?.job_id ?? jobId;
        }

        let jobStatus: string | null = null;
        if (resolvedJobId) {
          const { data: jobRow } = await createSupabaseServiceClient()
            .from("jobs")
            .select("status")
            .eq("id", resolvedJobId)
            .single();
          jobStatus = (jobRow as { status: string } | null)?.status ?? null;
        }

        resultPayload = { success: true, completed: completedAt != null, completedAt, jobStatus };
        break;
      }

      // ── classify-job ────────────────────────────────────────────────────
      case "classifyJob":
      case "classify-job": {
        const resolved = await resolveJobId(parameters);
        if ("error" in resolved) { resultPayload = { success: false, ...resolved }; break; }
        const { classifyJob } = await import("./classification-service");
        const result = await classifyJob(resolved.jobId);
        resultPayload = result.success
          ? { success: true, requiredSkill: result.classification.requiredSkill, urgency: result.classification.urgency, jobCategory: result.classification.jobCategory, alreadyDone: result.alreadyDone }
          : { success: false, error: result.error, message: result.message };
        break;
      }

      // ── price-job ───────────────────────────────────────────────────────
      case "priceJob":
      case "price-job": {
        const resolved = await resolveJobId(parameters);
        if ("error" in resolved) { resultPayload = { success: false, ...resolved }; break; }
        const { priceJob } = await import("./pricing-service");
        const result = await priceJob(resolved.jobId);
        resultPayload = result.success
          ? { success: true, calloutFeePence: result.estimate.calloutFeePence, repairEstimateMinPence: result.estimate.repairEstimateMinPence, repairEstimateMaxPence: result.estimate.repairEstimateMaxPence, currency: result.estimate.currency, explanation: result.estimate.explanation, alreadyDone: result.alreadyDone }
          : { success: false, error: result.error, message: result.message };
        break;
      }

      // ── get-available-slots ─────────────────────────────────────────────
      case "getAvailableSlots":
      case "get-available-slots": {
        const resolved = await resolveJobId(parameters);
        if ("error" in resolved) { resultPayload = { success: false, ...resolved }; break; }
        const { getAvailableSlots } = await import("./scheduling-service");
        const result = await getAvailableSlots(resolved.jobId);
        if (!result.success) { resultPayload = { success: false, error: result.error, message: result.message }; break; }
        const maxSlots = typeof parameters.maxSlots === "number" && parameters.maxSlots > 0 ? parameters.maxSlots : 5;
        resultPayload = {
          success: true,
          slots: result.slots.slice(0, maxSlots).map((s) => ({
            workerId: s.workerId,
            workerName: s.workerName,
            startsAt: s.startsAt.toISOString(),
            endsAt: s.endsAt.toISOString(),
          })),
        };
        break;
      }

      // ── hold-slot ───────────────────────────────────────────────────────
      case "holdSlot":
      case "hold-slot": {
        const jobId = parameters.jobId as string | undefined;
        const workerId = parameters.workerId as string | undefined;
        const startsAtStr = parameters.startsAt as string | undefined;
        const endsAtStr = parameters.endsAt as string | undefined;

        if (!jobId || !workerId || !startsAtStr || !endsAtStr) {
          resultPayload = { success: false, error: "bad_request", message: "Missing jobId, workerId, startsAt, or endsAt." };
          break;
        }

        const startsAt = new Date(startsAtStr);
        const endsAt = new Date(endsAtStr);

        if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
          resultPayload = { success: false, error: "bad_request", message: "startsAt and endsAt must be valid ISO timestamps." };
          break;
        }
        if (endsAt <= startsAt) {
          resultPayload = { success: false, error: "bad_request", message: "endsAt must be after startsAt." };
          break;
        }

        const { createReservation } = await import("./reservation-service");
        const result = await createReservation(jobId, workerId, startsAt, endsAt);
        resultPayload = result.success
          ? { success: true, reservationId: result.reservation.id, expiresAt: result.reservation.expiresAt, alreadyDone: result.alreadyDone }
          : { success: false, error: result.error, message: result.message };
        break;
      }

      // ── create-payment-session ──────────────────────────────────────────
      case "createPaymentSession":
      case "create-payment-session": {
        const jobId = parameters.jobId as string | undefined;
        if (!jobId) { resultPayload = { success: false, error: "bad_request", message: "Missing jobId." }; break; }
        const { createPaymentSession } = await import("./payment-service");
        const result = await createPaymentSession(jobId);
        resultPayload = result.success
          ? { success: true, jobId: result.jobId, paymentId: result.paymentId, paymentUrl: result.paymentUrl, amountPence: result.amountPence, currency: result.currency, alreadyDone: result.alreadyDone }
          : { success: false, error: result.error, message: result.message };
        break;
      }

      // ── summarise-call ──────────────────────────────────────────────────
      case "summariseCall":
      case "summarise-call": {
        const sessionId = parameters.sessionId as string | undefined;
        if (!sessionId) { resultPayload = { success: false, error: "bad_request", message: "Missing sessionId." }; break; }
        const result = await generateCallSummary(sessionId);
        resultPayload = result.success
          ? { success: true, summary: result.summary, alreadyDone: result.alreadyDone }
          : { success: false, error: result.error, message: result.message };
        break;
      }

      // ── generate-intake-token ───────────────────────────────────────────
      case "generateIntakeToken":
      case "generate-intake-token": {
        const sessionId = parameters.sessionId as string | undefined;
        if (!sessionId) { resultPayload = { success: false, error: "bad_request", message: "Missing sessionId." }; break; }
        const { issueIntakeFormToken } = await import("./call-session-service");
        const { appConfig } = await import("@/config/app-config");
        let tokenResult: { token: string; expiresAt: Date };
        try {
          tokenResult = await issueIntakeFormToken(sessionId);
        } catch (err) {
          resultPayload = { success: false, error: "token_error", message: err instanceof Error ? err.message : String(err) };
          break;
        }
        resultPayload = {
          success: true,
          token: tokenResult.token,
          intakeFormUrl: `${appConfig.appUrl}/intake/${tokenResult.token}`,
          expiresAt: tokenResult.expiresAt.toISOString(),
        };
        break;
      }

      // ── unknown tool ────────────────────────────────────────────────────
      default: {
        resultPayload = {
          success: false,
          error: "unknown_tool",
          message: `Tool "${name}" is not registered on this server.`,
        };
      }
    }

    return { toolCallId: id, result: JSON.stringify(resultPayload) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vapi-webhook] tool dispatch error for "${name}":`, message);
    return {
      toolCallId: id,
      result: JSON.stringify({ success: false, error: "server_error", message }),
    };
  }
}

// ─── Top-level router ─────────────────────────────────────────────────────────

/**
 * Route an incoming Vapi message to the appropriate handler.
 *
 * Returns a discriminated union indicating:
 *   - type: "event"  — informational event; respond with 200 {} to Vapi
 *   - type: "tool-calls" — synchronous tool response; body = { results: [...] }
 *   - type: "ignored" — unknown/unhandled type; respond 200 {} to Vapi
 */
export type HandleVapiMessageResult =
  | { type: "event"; result: VapiEventResult }
  | { type: "tool-calls"; result: VapiToolCallsResult }
  | { type: "ignored"; eventType: string };

export async function handleVapiMessage(
  message: VapiMessage,
): Promise<HandleVapiMessageResult> {
  const t = message.type;

  switch (t) {
    case "status-update": {
      const ev = message as VapiStatusUpdateMessage;
      const result =
        ev.status === "in-progress"
          ? await handleCallStarted(ev)
          : ev.status === "ended"
            ? await handleCallEnded(ev)
            : { success: true as const, action: `status_${ev.status}_acknowledged` };
      return { type: "event", result };
    }

    case "end-of-call-report":
      return {
        type: "event",
        result: await handleEndOfCallReport(message as VapiEndOfCallReportMessage),
      };

    case "conversation-update":
      return {
        type: "event",
        result: await handleConversationUpdate(message as VapiConversationUpdateMessage),
      };

    case "tool-calls":
      return {
        type: "tool-calls",
        result: await handleToolCalls(message as VapiToolCallsMessage),
      };

    default:
      console.log(`[vapi-webhook] unhandled event type: ${t} — acknowledged`);
      return { type: "ignored", eventType: t };
  }
}
