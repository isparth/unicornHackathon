/**
 * Reservation Service
 *
 * Creates, holds, releases, and expires worker slot reservations.
 *
 * Core operation — createReservation(jobId, workerId, startsAt, endsAt):
 *   1. Verifies the job exists and is in a state that allows reservation
 *      (priced or slot_held — slot_held allows re-hold for idempotency).
 *   2. Verifies the worker is active.
 *   3. Checks for overlapping active reservations or confirmed jobs for the
 *      same worker — returns overlap_conflict if a clash is found.
 *      (The DB exclusion constraint is the final guard; this check gives a
 *      clear typed error before hitting the constraint violation.)
 *   4. Releases any previous held reservation on the same job (idempotent
 *      re-selection: customer picked a different slot).
 *   5. Inserts the new reservation with expires_at = now + hold duration.
 *   6. Updates jobs.reservation_id, jobs.assigned_worker_id,
 *      jobs.selected_slot_starts_at/ends_at, and advances status to slot_held.
 *
 * releaseReservation(reservationId):
 *   - Sets reservation status to 'released'.
 *   - Clears the job's reservation_id and slot fields.
 *   - Moves job back to 'priced' so it can be re-scheduled.
 *
 * expireReservation(reservationId):
 *   - Sets reservation status to 'expired'.
 *   - Moves job to 'expired' state.
 *   - Called by the Supabase cron sweep and directly in tests.
 *
 * getReservation(reservationId) — lazy expiry:
 *   - Reads a reservation from the DB.
 *   - If status is 'held' but expires_at < now, immediately expires it in
 *     the DB and returns the record with status 'expired'.
 *   - This is the primary correctness guarantee: an expired slot can never
 *     appear as available even if the cron sweep hasn't run yet.
 *
 * All writes are idempotent where possible.
 */

import { appConfig } from "@/config/app-config";
import { createSupabaseServiceClient } from "@/server/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReservationRecord = {
  id: string;
  jobId: string;
  workerId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
};

export type CreateReservationResult =
  | { success: true; reservation: ReservationRecord; alreadyDone: boolean }
  | {
      success: false;
      error:
        | "job_not_found"
        | "invalid_job_state"
        | "worker_not_found"
        | "worker_inactive"
        | "overlap_conflict"
        | "db_error";
      message: string;
    };

export type ReleaseReservationResult =
  | { success: true }
  | { success: false; error: "not_found" | "db_error"; message: string };

export type ExpireReservationResult =
  | { success: true }
  | { success: false; error: "not_found" | "db_error"; message: string };

export type GetReservationResult =
  | { success: true; reservation: ReservationRecord; wasLazilyExpired: boolean }
  | { success: false; error: "not_found" | "db_error"; message: string };

// Job statuses that are allowed to receive a reservation
const RESERVABLE_STATUSES = new Set(["priced", "slot_held"]);

// ─── Lazy expiry helper ───────────────────────────────────────────────────────

/**
 * Returns true if a reservation is in 'held' status but its expires_at
 * timestamp is in the past relative to `now`.
 */
export function isHeldButExpired(reservation: ReservationRecord, now: Date = new Date()): boolean {
  return reservation.status === "held" && new Date(reservation.expiresAt) < now;
}

// ─── Overlap check ────────────────────────────────────────────────────────────

/**
 * Check whether a proposed slot [startsAt, endsAt) conflicts with any active
 * reservation or confirmed job for the given worker.
 * Returns true if there IS a conflict.
 */
export async function hasOverlappingReservation(
  workerId: string,
  startsAt: Date,
  endsAt: Date,
  excludeReservationId?: string,
  now: Date = new Date(),
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();

  // Check active reservations — exclude held reservations that have already
  // expired (lazy expiry: treat them as non-blocking even if the cron sweep
  // hasn't cleaned them up yet).
  let resQuery = supabase
    .from("reservations")
    .select("id, status, expires_at")
    .eq("worker_id", workerId)
    .in("status", ["held", "confirmed"])
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());

  if (excludeReservationId) {
    resQuery = resQuery.neq("id", excludeReservationId);
  }

  const { data: conflictingReservations } = await resQuery;

  // Filter out held reservations whose hold window has already passed
  const activeConflicts = (conflictingReservations ?? []).filter((r) => {
    const row = r as { status: string; expires_at: string };
    if (row.status === "held" && new Date(row.expires_at) < now) return false;
    return true;
  });

  if (activeConflicts.length > 0) return true;

  // Check confirmed jobs
  const { data: conflictingJobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("assigned_worker_id", workerId)
    .eq("status", "confirmed")
    .lt("selected_slot_starts_at", endsAt.toISOString())
    .gt("selected_slot_ends_at", startsAt.toISOString());

  return (conflictingJobs?.length ?? 0) > 0;
}

// ─── createReservation ────────────────────────────────────────────────────────

export async function createReservation(
  jobId: string,
  workerId: string,
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date(),
): Promise<CreateReservationResult> {
  const supabase = createSupabaseServiceClient();

  // 1. Load the job
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status, reservation_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return {
      success: false,
      error: "job_not_found",
      message: `Job not found: ${jobId}`,
    };
  }

  const { status, reservation_id: existingReservationId } = job as {
    status: string;
    reservation_id: string | null;
  };

  if (!RESERVABLE_STATUSES.has(status)) {
    return {
      success: false,
      error: "invalid_job_state",
      message: `Job is in state "${status}" which does not allow reservation. Job must be priced first.`,
    };
  }

  // 2. Idempotency: if the job already has a reservation for the same slot/worker, return it
  if (existingReservationId) {
    const { data: existingRes } = await supabase
      .from("reservations")
      .select("id, job_id, worker_id, status, starts_at, ends_at, expires_at")
      .eq("id", existingReservationId)
      .eq("status", "held")
      .single();

    const r = existingRes as RawReservationRow | null;

    // Treat a held-but-expired record as if it doesn't exist — fall through
    // to create a fresh reservation rather than returning a stale one.
    const isStillActive = r && new Date(r.expires_at) >= now;

    if (
      isStillActive &&
      r.worker_id === workerId &&
      new Date(r.starts_at).getTime() === startsAt.getTime()
    ) {
      return {
        success: true,
        reservation: mapReservationRow(r),
        alreadyDone: true,
      };
    }

    // Different slot, different worker, or hold expired — release/expire the previous reservation
    if (r) {
      const newStatus = new Date(r.expires_at) < now ? "expired" : "released";
      await supabase
        .from("reservations")
        .update({ status: newStatus, updated_at: now.toISOString() })
        .eq("id", existingReservationId)
        .eq("status", "held");
    }
  }

  // 3. Verify worker exists and is active
  const { data: worker, error: workerError } = await supabase
    .from("workers")
    .select("id, active")
    .eq("id", workerId)
    .single();

  if (workerError || !worker) {
    return {
      success: false,
      error: "worker_not_found",
      message: `Worker not found: ${workerId}`,
    };
  }

  if (!(worker as { active: boolean }).active) {
    return {
      success: false,
      error: "worker_inactive",
      message: `Worker ${workerId} is not active and cannot accept reservations.`,
    };
  }

  // 4. Application-layer overlap check (DB constraint is the final guard)
  const hasConflict = await hasOverlappingReservation(workerId, startsAt, endsAt);
  if (hasConflict) {
    return {
      success: false,
      error: "overlap_conflict",
      message: `Worker ${workerId} already has an active booking that overlaps ${startsAt.toISOString()}–${endsAt.toISOString()}.`,
    };
  }

  // 5. Insert the reservation
  const expiresAt = new Date(now.getTime() + appConfig.reservationHoldMinutes * 60 * 1000);

  const { data: newRes, error: insertError } = await supabase
    .from("reservations")
    .insert({
      job_id: jobId,
      worker_id: workerId,
      status: "held",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id, job_id, worker_id, status, starts_at, ends_at, expires_at")
    .single();

  if (insertError || !newRes) {
    // Could be the DB exclusion constraint firing on a race condition
    const isOverlap =
      insertError?.message?.includes("no_overlapping_active_reservations") ||
      insertError?.code === "23P01"; // PostgreSQL exclusion violation

    return {
      success: false,
      error: isOverlap ? "overlap_conflict" : "db_error",
      message: isOverlap
        ? `Slot conflict detected by database constraint for worker ${workerId}.`
        : `Failed to create reservation: ${insertError?.message ?? "unknown error"}`,
    };
  }

  // 6. Update the job: link reservation, assign worker, set slot, advance to slot_held
  const { error: jobUpdateError } = await supabase
    .from("jobs")
    .update({
      status: "slot_held",
      reservation_id: (newRes as { id: string }).id,
      assigned_worker_id: workerId,
      selected_slot_starts_at: startsAt.toISOString(),
      selected_slot_ends_at: endsAt.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", jobId);

  if (jobUpdateError) {
    return {
      success: false,
      error: "db_error",
      message: `Reservation created but failed to update job: ${jobUpdateError.message}`,
    };
  }

  return {
    success: true,
    reservation: mapReservationRow(newRes as RawReservationRow),
    alreadyDone: false,
  };
}

// ─── getReservation (lazy expiry) ─────────────────────────────────────────────

/**
 * Read a reservation by ID, applying lazy expiry on the way out.
 *
 * If the reservation is 'held' but its expires_at is in the past, this
 * function immediately triggers expireReservation() in the DB and returns
 * the record with status 'expired' and wasLazilyExpired: true.
 *
 * Callers never see a stale 'held' record — correctness is enforced at
 * read time without waiting for the cron sweep.
 */
export async function getReservation(
  reservationId: string,
  now: Date = new Date(),
): Promise<GetReservationResult> {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, job_id, worker_id, status, starts_at, ends_at, expires_at")
    .eq("id", reservationId)
    .single();

  if (error || !data) {
    return { success: false, error: "not_found", message: `Reservation not found: ${reservationId}` };
  }

  const raw = data as RawReservationRow;
  const reservation = mapReservationRow(raw);

  // Lazy expiry: if held but the window has passed, expire it now
  if (isHeldButExpired(reservation, now)) {
    const expireResult = await expireReservation(reservationId, now);
    if (!expireResult.success) {
      return { success: false, error: "db_error", message: `Failed to lazily expire reservation: ${expireResult.message}` };
    }
    return {
      success: true,
      reservation: { ...reservation, status: "expired" },
      wasLazilyExpired: true,
    };
  }

  return { success: true, reservation, wasLazilyExpired: false };
}

// ─── releaseReservation ───────────────────────────────────────────────────────

export async function releaseReservation(
  reservationId: string,
  now: Date = new Date(),
): Promise<ReleaseReservationResult> {
  const supabase = createSupabaseServiceClient();

  // Load reservation to get job_id
  const { data: res, error: loadError } = await supabase
    .from("reservations")
    .select("id, job_id, status")
    .eq("id", reservationId)
    .single();

  if (loadError || !res) {
    return { success: false, error: "not_found", message: `Reservation not found: ${reservationId}` };
  }

  const { job_id: jobId } = res as { job_id: string; status: string };

  // Mark reservation as released
  const { error: resUpdateError } = await supabase
    .from("reservations")
    .update({ status: "released", updated_at: now.toISOString() })
    .eq("id", reservationId);

  if (resUpdateError) {
    return { success: false, error: "db_error", message: `Failed to release reservation: ${resUpdateError.message}` };
  }

  // Clear the slot on the job, move back to priced
  await supabase
    .from("jobs")
    .update({
      status: "priced",
      reservation_id: null,
      assigned_worker_id: null,
      selected_slot_starts_at: null,
      selected_slot_ends_at: null,
      updated_at: now.toISOString(),
    })
    .eq("id", jobId)
    .eq("reservation_id", reservationId);

  return { success: true };
}

// ─── expireReservation ────────────────────────────────────────────────────────

export async function expireReservation(
  reservationId: string,
  now: Date = new Date(),
): Promise<ExpireReservationResult> {
  const supabase = createSupabaseServiceClient();

  const { data: res, error: loadError } = await supabase
    .from("reservations")
    .select("id, job_id, status")
    .eq("id", reservationId)
    .single();

  if (loadError || !res) {
    return { success: false, error: "not_found", message: `Reservation not found: ${reservationId}` };
  }

  const { job_id: jobId } = res as { job_id: string };

  const { error: resUpdateError } = await supabase
    .from("reservations")
    .update({ status: "expired", updated_at: now.toISOString() })
    .eq("id", reservationId);

  if (resUpdateError) {
    return { success: false, error: "db_error", message: `Failed to expire reservation: ${resUpdateError.message}` };
  }

  // Move job to expired state
  await supabase
    .from("jobs")
    .update({
      status: "expired",
      updated_at: now.toISOString(),
    })
    .eq("id", jobId)
    .eq("reservation_id", reservationId);

  return { success: true };
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

type RawReservationRow = {
  id: string;
  job_id: string;
  worker_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  expires_at: string;
};

function mapReservationRow(raw: RawReservationRow): ReservationRecord {
  return {
    id: raw.id,
    jobId: raw.job_id,
    workerId: raw.worker_id,
    status: raw.status,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    expiresAt: raw.expires_at,
  };
}
