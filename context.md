# Codebase Index — Milestones 1–4

Function/type index for navigation. No prose. Update whenever a signature or type changes.

---

## Table of Contents

1. [Enums & Domain Types](#1-enums--domain-types)
2. [Config](#2-config)
3. [Supabase & Stripe Clients](#3-supabase--stripe-clients)
4. [Job State Machine](#4-job-state-machine)
5. [Services](#5-services)
   - [call-session-service](#call-session-service)
   - [intake-token-service](#intake-token-service)
   - [call-summary-service](#call-summary-service)
   - [classification-service](#classification-service)
   - [pricing-service](#pricing-service)
   - [scheduling-service](#scheduling-service)
   - [reservation-service](#reservation-service)
   - [payment-service](#payment-service)
   - [webhook-service](#webhook-service)
   - [expiry-sweep-service](#expiry-sweep-service)
   - [notification-service](#notification-service)
   - [dashboard-scheduling-service](#dashboard-scheduling-service)
   - [job-domain-service](#job-domain-service)
6. [Server Actions](#6-server-actions)
7. [API Tool Routes](#7-api-tool-routes)
8. [Webhook Routes](#8-webhook-routes)
9. [DB Schema Summary](#9-db-schema-summary)
10. [Migrations](#10-migrations)

---

## 1. Enums & Domain Types

**`src/domain/enums.ts`**

```ts
jobStatuses      = ['intake','qualified','priced','slot_held','awaiting_payment','confirmed','expired','completed']
paymentStatuses  = ['pending','paid','failed','refunded']
reservationStatuses = ['held','released','expired','confirmed']
urgencyLevels    = ['emergency','same_day','scheduled']
workerSkills     = ['plumbing','heating','electrical']
uploadedAssetTypes = ['image','transcript','document']
```

**`src/domain/types.ts`**

| Type | Key fields |
|---|---|
| `JobStatus` | union of `jobStatuses` |
| `Urgency` | union of `urgencyLevels` |
| `WorkerSkill` | union of `workerSkills` |
| `PaymentStatus` | union of `paymentStatuses` |
| `ReservationStatus` | union of `reservationStatuses` |
| `EntityId` | `string` |
| `ServiceBusiness` | `id, name, phoneNumber, serviceArea` |
| `Customer` | `id, serviceBusinessId, name, phoneNumber, addressLine1, city, postcode, metadata` |
| `CallSession` | `id, serviceBusinessId, customerId, jobId, providerSessionId, transcript, intakeFormToken, intakeFormTokenExpiresAt, intakeFormCompletedAt` |
| `PriceEstimate` | `calloutFeePence, repairEstimateMinPence, repairEstimateMaxPence, currency, explanation` |
| `Job` | `id, customerId, status: JobStatus, problemSummary, jobCategory, urgency, requiredSkill, assignedWorkerId, reservationId, paymentId, selectedSlotStartsAt, selectedSlotEndsAt, priceEstimate` |
| `Worker` | `id, serviceBusinessId, name, skill, serviceArea, active` |
| `AvailabilityWindow` | `id, workerId, startsAt, endsAt` |
| `Reservation` | `id, jobId, workerId, status, startsAt, endsAt, expiresAt` |
| `Payment` | `id, jobId, reservationId, status: PaymentStatus, amountPence, currency, stripeCheckoutSessionId, stripePaymentIntentId` |
| `UploadedAsset` | `id, jobId, callSessionId, type, storagePath, analysisStatus, analysisResult` |

---

## 2. Config

**`src/config/app-config.ts`**

```ts
export const appConfig: AppConfig

type AppConfig = {
  serviceCredentials: {
    supabase:  { url, anonKey, serviceRoleKey }
    openai:    { apiKey, summaryModel }          // model default: "gpt-4.1-mini"
    stripe:    { secretKey, publishableKey, webhookSecret }
  }
  appUrl: string                        // NEXT_PUBLIC_APP_URL
  intakeToken: { secret, expiryMinutes }  // default 30 min
  reservationHoldMinutes: number          // default 120
  pricingDefaults: {
    currency: string                    // default "gbp"
    calloutFeePence: number             // default 8000
    repairEstimateMinPence: number      // default 10000
    repairEstimateMaxPence: number      // default 25000
  }
  missingRequiredKeys: string[]
}

export function createAppConfig(environment: Record<string, string | undefined>): AppConfig
```

Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INTAKE_TOKEN_SECRET`, `OPENAI_API_KEY`

---

## 3. Supabase & Stripe Clients

**`src/server/supabase/client.ts`**

```ts
createSupabaseServiceClient(): SupabaseClient   // uses SUPABASE_SERVICE_ROLE_KEY, bypasses RLS
```

**`src/server/stripe/client.ts`**

```ts
getStripeClient(): Stripe   // lazy singleton, throws if STRIPE_SECRET_KEY missing
```

---

## 4. Job State Machine

**`src/domain/job-state-machine.ts`**

```ts
VALID_TRANSITIONS: Record<JobStatus, JobStatus[]>
// intake        → [qualified]
// qualified     → [priced]
// priced        → [slot_held, expired]
// slot_held     → [awaiting_payment, priced, expired]
// awaiting_payment → [confirmed, slot_held, expired]
// confirmed     → [completed]
// expired       → []
// completed     → []

canTransition(from: JobStatus, to: JobStatus): boolean
validateTransition(from: JobStatus, to: JobStatus): void   // throws if invalid

REQUIRED_FIELDS_FOR_TRANSITION: Record<JobStatus, string[]>
// qualified  requires: problemSummary
// priced     requires: jobCategory, urgency, requiredSkill, priceEstimate
// slot_held  requires: assignedWorkerId, reservationId, selectedSlotStartsAt, selectedSlotEndsAt
// awaiting_payment requires: paymentId
```

---

## 5. Services

### call-session-service

**`src/server/services/call-session-service.ts`**

```ts
issueIntakeFormToken(sessionId: string): Promise<{ token: string; expiresAt: Date }>
// Idempotent. Creates/updates intake_form_token on call_sessions row.
// Throws on DB error or session not found.
```

---

### intake-token-service

**`src/server/services/intake-token-service.ts`**

```ts
generateToken(sessionId: string, expiresAt: Date): string
// HMAC-signed token encoding sessionId + expiry. Uses appConfig.intakeToken.secret.

verifyToken(token: string): { sessionId: string; expiresAt: Date } | null
// Returns null if signature invalid or token expired.
```

---

### call-summary-service

**`src/server/services/call-summary-service.ts`**

```ts
type GenerateCallSummaryResult =
  | { success: true; summary: string; alreadyDone: boolean }
  | { success: false; error: "not_found" | "no_transcript" | "transcript_too_short" | "openai_error" | "db_error"; message: string }

generateCallSummary(sessionId: string): Promise<GenerateCallSummaryResult>
// Reads transcript from call_sessions, calls OpenAI, writes problem_summary to jobs.
// Idempotent: returns alreadyDone=true if problem_summary already set.
```

---

### classification-service

**`src/server/services/classification-service.ts`**

```ts
type ClassificationOutput = {
  requiredSkill: WorkerSkill   // "plumbing" | "heating" | "electrical"
  urgency: Urgency             // "emergency" | "same_day" | "scheduled"
  jobCategory: string
}

type ClassifyJobResult =
  | { success: true; classification: ClassificationOutput; alreadyDone: boolean }
  | { success: false; error: "not_found" | "no_summary" | "invalid_output" | "openai_error" | "db_error"; message: string }

classifyJob(jobId: string): Promise<ClassifyJobResult>
// Reads problem_summary, calls OpenAI, writes requiredSkill/urgency/jobCategory to job.
// Idempotent: alreadyDone=true if all fields already set.
```

---

### pricing-service

**`src/server/services/pricing-service.ts`**

```ts
type PriceJobResult =
  | { success: true; estimate: PriceEstimate; alreadyDone: boolean }
  | { success: false; error: "not_found" | "not_classified" | "db_error"; message: string }

priceJob(jobId: string): Promise<PriceJobResult>
// Requires job.urgency + job.requiredSkill to be set (classified).
// Writes price_estimate to job, advances job to "priced".
// Idempotent: alreadyDone=true if price_estimate already set.
```

---

### scheduling-service

**`src/server/services/scheduling-service.ts`**

```ts
SLOT_DURATION_MINUTES = 120

SEARCH_HORIZON_HOURS: Record<Urgency, number>
// emergency: 24h, same_day: 48h, scheduled: 336h (14 days)

type BookableSlot = {
  workerId: string
  workerName: string
  startsAt: Date
  endsAt: Date
}

type GetAvailableSlotsResult =
  | { success: true; slots: BookableSlot[] }
  | { success: false; error: "job_not_found" | "not_classified" | "db_error"; message: string }

getAvailableSlots(jobId: string, now?: Date): Promise<GetAvailableSlotsResult>
// Read-only. Requires job.requiredSkill + job.urgency.
// Returns slots sorted by startsAt ASC, workerName ASC.

// Helpers (exported for testing):
overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean
generateSlots(windowStart, windowEnd, slotDurationMs, earliest, horizon): Array<{ startsAt: Date; endsAt: Date }>
```

---

### reservation-service

**`src/server/services/reservation-service.ts`**

```ts
type ReservationRecord = {
  id: string; jobId: string; workerId: string
  status: string; startsAt: string; endsAt: string; expiresAt: string
}

type CreateReservationResult =
  | { success: true; reservation: ReservationRecord; alreadyDone: boolean }
  | { success: false; error: "job_not_found" | "invalid_job_state" | "worker_not_found" | "worker_inactive" | "overlap_conflict" | "db_error"; message: string }

type ReleaseReservationResult =
  | { success: true }
  | { success: false; error: "not_found" | "db_error"; message: string }

type ExpireReservationResult =
  | { success: true }
  | { success: false; error: "not_found" | "db_error"; message: string }

type GetReservationResult =
  | { success: true; reservation: ReservationRecord; wasLazilyExpired: boolean }
  | { success: false; error: "not_found" | "db_error"; message: string }

// ── Functions ──

isHeldButExpired(reservation: ReservationRecord, now?: Date): boolean
// Pure helper. True when status='held' AND expiresAt < now.

hasOverlappingReservation(
  workerId: string, startsAt: Date, endsAt: Date,
  excludeReservationId?: string, now?: Date
): Promise<boolean>
// Filters out held-but-expired rows before checking for conflict.

createReservation(
  jobId: string, workerId: string, startsAt: Date, endsAt: Date, now?: Date
): Promise<CreateReservationResult>
// Requires job in "priced" or "slot_held".
// Sets expires_at = now + appConfig.reservationHoldMinutes.
// Advances job to "slot_held".

getReservation(reservationId: string, now?: Date): Promise<GetReservationResult>
// LAZY EXPIRY: if held + expired, calls expireReservation() and returns status="expired".

releaseReservation(reservationId: string, now?: Date): Promise<ReleaseReservationResult>
// Sets reservation status="released", moves job back to "priced".

expireReservation(reservationId: string, now?: Date): Promise<ExpireReservationResult>
// Sets reservation status="expired", moves job to "expired".
```

---

### payment-service

**`src/server/services/payment-service.ts`**

```ts
type CreatePaymentSessionResult =
  | { success: true; jobId: string; paymentId: string; paymentUrl: string; amountPence: number; currency: string; alreadyDone: boolean }
  | { success: false; error: "job_not_found" | "invalid_job_state" | "intake_form_incomplete" | "missing_customer_fields" | "stripe_not_configured" | "stripe_error" | "db_error"; message: string }

createPaymentSession(jobId: string): Promise<CreatePaymentSessionResult>
// Hard gates (in order):
//   1. Job must exist and be in: priced | slot_held | awaiting_payment
//   2. intake_form_completed_at must be non-null on a linked call_session
//   3. Customer must have: name, address_line_1, city, postcode
// Creates Stripe Checkout Session (mode="payment").
// Writes payments row (status="pending"), links jobs.payment_id, advances job to "awaiting_payment".
// Idempotent: returns existing session if job already in awaiting_payment with pending payment.
```

---

### webhook-service

**`src/server/services/webhook-service.ts`**

```ts
type WebhookHandlerResult =
  | { success: true; alreadyProcessed: boolean }
  | { success: false; error: "payment_not_found" | "already_processed" | "db_error"; message: string }

handleCheckoutSessionCompleted(
  stripeSessionId: string, stripePaymentIntentId: string | null
): Promise<WebhookHandlerResult>
// payment → "paid", job → "confirmed", reservation → "confirmed"
// Idempotent: alreadyProcessed=true if payment already "paid".

handleCheckoutSessionExpired(stripeSessionId: string): Promise<WebhookHandlerResult>
// payment → "failed", job → "slot_held"
// Idempotent: alreadyProcessed=true if payment already "failed" or "paid".

handlePaymentIntentFailed(stripePaymentIntentId: string): Promise<WebhookHandlerResult>
// payment → "failed", job → "slot_held"
// Looks up by stripe_payment_intent_id.
// Idempotent: alreadyProcessed=true if payment already "failed" or "paid".
```

---

### expiry-sweep-service

**`src/server/services/expiry-sweep-service.ts`**

```ts
type SweepResult =
  | { success: true; expiredReservationIds: string[]; expiredJobIds: string[] }
  | { success: false; error: string }

sweepExpiredReservations(now?: Date): Promise<SweepResult>
// TS mirror of expire_stale_reservations() SQL function.
// Finds held reservations with expires_at < now.
// Marks them "expired". Moves linked jobs to "expired" (only if slot_held | awaiting_payment).
// Idempotent — status guards prevent double-transition.
// Use directly where pg_cron is unavailable (e.g. Supabase free tier).
```

---

### notification-service

**`src/server/services/notification-service.ts`**

```ts
type NotificationEventType = "payment_requested" | "booking_confirmed" | "payment_failed" | "reservation_expired"

type NotificationResult =
  | { success: true; provider: string }
  | { success: false; provider: string; error: string }

// Payload types:
type PaymentRequestedPayload  = { event, jobId, customerPhone, customerName, paymentUrl, amountPence, currency }
type BookingConfirmedPayload   = { event, jobId, customerPhone, customerName, workerName, slotStartsAt, slotEndsAt }
type PaymentFailedPayload      = { event, jobId, customerPhone, customerName, reason? }
type ReservationExpiredPayload = { event, jobId, reservationId, customerPhone?, customerName? }

// Provider interface:
interface NotificationProvider {
  readonly name: string
  send(payload: NotificationPayload): Promise<NotificationResult>
}

// Logging provider (default / dev / test):
class LoggingNotificationProvider implements NotificationProvider {
  readonly name = "logging"
  readonly events: LoggedNotificationEvent[]   // inspectable in tests
  send(payload): Promise<NotificationResult>
  clear(): void
}

// Service class:
class NotificationService {
  constructor(provider?: NotificationProvider)   // defaults to LoggingNotificationProvider
  setProvider(provider: NotificationProvider): void
  getProvider(): NotificationProvider
  notifyPaymentRequested(payload: Omit<PaymentRequestedPayload, "event">):   Promise<NotificationResult>
  notifyBookingConfirmed(payload: Omit<BookingConfirmedPayload, "event">):   Promise<NotificationResult>
  notifyPaymentFailed(payload: Omit<PaymentFailedPayload, "event">):         Promise<NotificationResult>
  notifyReservationExpired(payload: Omit<ReservationExpiredPayload, "event">): Promise<NotificationResult>
  // All send() calls are wrapped in try/catch — never throws into caller.
}

// Singleton:
export const notificationService: NotificationService   // uses LoggingNotificationProvider
```

---

### dashboard-scheduling-service

**`src/server/services/dashboard-scheduling-service.ts`**

```ts
getConfirmedJobs(businessId: string): Promise<Job[]>
getActiveReservations(businessId: string): Promise<Reservation[]>
getWorkerCalendar(workerId: string, from: Date, to: Date): Promise<{ confirmed: Job[]; held: Reservation[] }>
// Used by dashboard views. Read-only.
```

---

### job-domain-service

**`src/server/services/job-domain-service.ts`**

```ts
getJobById(jobId: string): Promise<Job | null>
getJobsByStatus(businessId: string, status: JobStatus): Promise<Job[]>
// Thin read helpers over the jobs table. No side effects.
```

---

## 6. Server Actions

**`src/app/actions/intake.ts`**

```ts
type SubmitIntakeFormResult =
  | { success: true; jobId: string }
  | { success: false; error: "token_invalid" | "token_expired" | "db_error"; message: string }

submitIntakeForm(formData: IntakeFormData): Promise<SubmitIntakeFormResult>
// Validates token, writes customer fields, uploads photos, marks form complete,
// advances job intake → qualified.
```

**`src/app/actions/intake-types.ts`**

```ts
type IntakeFormData = {
  token: string
  name: string
  addressLine1: string
  city: string
  postcode: string
  phoneNumber: string
  photos?: File[]          // up to 5, stored in Supabase Storage "job-photos" bucket
}
```

**`src/app/actions/payment.ts`**

```ts
type CreatePaymentSessionActionResult =
  | { success: true; paymentUrl: string; paymentId: string; amountPence: number; currency: string; alreadyDone: boolean }
  | { success: false; error: string; message: string }

createPaymentSessionAction(jobId: string): Promise<CreatePaymentSessionActionResult>
// Thin wrapper over payment-service.createPaymentSession().
```

---

## 7. API Tool Routes

All routes: `POST`, JSON body, respond `{ success, ...payload }` or `{ success: false, error, message }`.
Shared helpers in `src/app/api/tools/_lib.ts`: `parseBody<T>`, `badRequest(msg)`, `serverError(msg)`, `ok(payload)`.

| Route | File | Request body | Success response |
|---|---|---|---|
| `POST /api/tools/create-call-session` | `create-call-session/route.ts` | `{ vapiCallId, serviceBusinessId, phoneNumber }` | `{ sessionId, intakeFormUrl, tokenExpiresAt }` |
| `POST /api/tools/generate-intake-token` | `generate-intake-token/route.ts` | `{ sessionId }` | `{ token, intakeFormUrl, expiresAt }` |
| `POST /api/tools/check-form-status` | `check-form-status/route.ts` | `{ sessionId? \| jobId? }` | `{ completed: boolean, completedAt: string\|null, jobStatus: string\|null }` |
| `POST /api/tools/summarise-call` | `summarise-call/route.ts` | `{ sessionId }` | `{ summary, alreadyDone }` |
| `POST /api/tools/classify-job` | `classify-job/route.ts` | `{ jobId? \| sessionId? }` | `{ requiredSkill, urgency, jobCategory, alreadyDone }` |
| `POST /api/tools/price-job` | `price-job/route.ts` | `{ jobId? \| sessionId? }` | `{ calloutFeePence, repairEstimateMinPence, repairEstimateMaxPence, currency, explanation, alreadyDone }` |
| `POST /api/tools/get-available-slots` | `get-available-slots/route.ts` | `{ jobId? \| sessionId?, maxSlots?: number }` | `{ slots: [{ workerId, workerName, startsAt, endsAt }] }` |
| `POST /api/tools/hold-slot` | `hold-slot/route.ts` | `{ jobId, workerId, startsAt, endsAt }` | `{ reservationId, expiresAt, alreadyDone }` |
| `POST /api/tools/create-payment-session` | `create-payment-session/route.ts` | `{ jobId }` | `{ jobId, paymentId, paymentUrl, amountPence, currency, alreadyDone }` |

**HTTP error codes used across tool routes:**

| Code | Meaning |
|---|---|
| 400 | Missing / invalid request body fields |
| 404 | Resource not found |
| 409 | Conflict (intake form incomplete, slot overlap) |
| 422 | Invalid state (not classified, not priced, etc.) |
| 500 | DB error, Stripe error, unhandled server error |
| 503 | Stripe not configured |

---

## 8. Webhook Routes

**`POST /api/webhooks/stripe`** — `src/app/api/webhooks/stripe/route.ts`

- Verifies `Stripe-Signature` header; returns `400` on failure.
- Routes to webhook-service handlers by `event.type`.
- `payment_not_found` → `200` (non-fatal, stops Stripe retrying).
- `db_error` → `500` (triggers Stripe retry).
- Unknown event types → `200` (acknowledged, no handler called).

| Stripe event | Handler called | Job transition |
|---|---|---|
| `checkout.session.completed` (mode=payment) | `handleCheckoutSessionCompleted` | `awaiting_payment` → `confirmed` |
| `checkout.session.expired` | `handleCheckoutSessionExpired` | `awaiting_payment` → `slot_held` |
| `payment_intent.payment_failed` | `handlePaymentIntentFailed` | `awaiting_payment` → `slot_held` |

---

## 9. DB Schema Summary

Tables (all in Supabase Postgres, public schema):

| Table | Key columns |
|---|---|
| `service_businesses` | `id, name, phone_number, service_area` |
| `customers` | `id, service_business_id, name, phone_number, address_line_1, city, postcode` |
| `call_sessions` | `id, service_business_id, customer_id, job_id, provider_session_id, transcript, intake_form_token, intake_form_token_expires_at, intake_form_completed_at` |
| `jobs` | `id, service_business_id, customer_id, status, problem_summary, job_category, urgency, required_skill, assigned_worker_id, reservation_id, payment_id, selected_slot_starts_at, selected_slot_ends_at, price_estimate (jsonb)` |
| `workers` | `id, service_business_id, name, skill, service_area, active` |
| `availability_windows` | `id, worker_id, starts_at, ends_at` |
| `reservations` | `id, job_id, worker_id, status, starts_at, ends_at, expires_at` |
| `payments` | `id, job_id, reservation_id, status, amount_pence, currency, stripe_checkout_session_id, stripe_payment_intent_id, metadata (jsonb)` |
| `uploaded_assets` | `id, job_id, call_session_id, type, storage_path, analysis_status, analysis_result` |

**Key DB constraints:**
- `reservations`: exclusion constraint `no_overlapping_active_reservations` via `btree_gist` (status IN ('held','confirmed'))
- `reservations`: partial index `reservations_worker_active_time_idx` on `(worker_id, starts_at, ends_at)` where active
- `reservations`: partial index `reservations_held_expires_at_idx` on `(expires_at)` where `status='held'`

**pg_cron job:**
- Name: `expire-stale-reservations`
- Schedule: `* * * * *` (every minute)
- Calls: `expire_stale_reservations()` — marks stale held reservations + linked jobs as expired

---

## 10. Migrations

| File | What it does |
|---|---|
| `202604250001_milestone_1_core_schema.sql` | All tables, enums, base indexes |
| `202604250002_enable_rls_on_public_tables.sql` | Row-level security on all public tables |
| `202604250003_milestone_2_intake_form.sql` | Intake form token columns on call_sessions |
| `202604250004_storage_job_photos.sql` | `job-photos` Supabase Storage bucket |
| `202604250005_add_job_category.sql` | `job_category` column on jobs |
| `202604250006_milestone_3_scheduling.sql` | btree_gist exclusion constraint, scheduling indexes |
| `202604250007_milestone_4_expiry_sweep.sql` | `expire_stale_reservations()` function + pg_cron job + held expiry index |
