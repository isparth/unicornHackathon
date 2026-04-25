/**
 * Expiry Sweep Service
 *
 * TypeScript mirror of the expire_stale_reservations() SQL function installed
 * by migration 202604250007_milestone_4_expiry_sweep.sql.
 *
 * The SQL pg_cron job is the primary mechanism that keeps the database clean,
 * but this module exists so that:
 *   1. The sweep logic can be unit-tested in TypeScript with the same mock
 *      infrastructure used by other services.
 *   2. The function can be called from an Edge Function / API route in
 *      environments where pg_cron is not available (e.g. Supabase free tier).
 *   3. Integration tests can exercise the full transition without a real DB.
 *
 * Idempotency:
 *   Every UPDATE uses status guards in the WHERE clause so replaying the sweep
 *   on already-transitioned rows is a safe no-op.  Running both this function
 *   AND the pg_cron job against the same rows produces no double-transitions.
 *
 * Relationship to lazy expiry:
 *   Lazy expiry (getReservation) is the correctness guarantee — it fires on
 *   every reservation read so an expired slot can never appear bookable.
 *   This sweep is the cleanup pass — it updates DB status so dashboards and
 *   the exclusion constraint reflect reality without app-layer intervention.
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SweepResult =
  | {
      success: true;
      expiredReservationIds: string[];
      expiredJobIds: string[];
    }
  | { success: false; error: string };

// ─── sweepExpiredReservations ─────────────────────────────────────────────────

/**
 * Find all held reservations whose expires_at < now, mark them expired, and
 * move their linked jobs to 'expired' status (if still in slot_held or
 * awaiting_payment).
 *
 * Returns the IDs of every reservation and job that was transitioned.
 * Returns empty arrays (not an error) when there is nothing to sweep.
 */
export async function sweepExpiredReservations(
  now: Date = new Date(),
): Promise<SweepResult> {
  const supabase = createSupabaseServiceClient();

  // ── Step 1: find stale held reservations ──────────────────────────────────
  const { data: staleRows, error: fetchError } = await supabase
    .from("reservations")
    .select("id")
    .eq("status", "held")
    .lt("expires_at", now.toISOString());

  if (fetchError) {
    return { success: false, error: `Failed to fetch stale reservations: ${fetchError.message}` };
  }

  const staleIds = (staleRows ?? []).map((r) => (r as { id: string }).id);

  if (staleIds.length === 0) {
    return { success: true, expiredReservationIds: [], expiredJobIds: [] };
  }

  // ── Step 2: mark reservations expired ─────────────────────────────────────
  const { data: updatedRes, error: resUpdateError } = await supabase
    .from("reservations")
    .update({ status: "expired", updated_at: now.toISOString() })
    .in("id", staleIds)
    .eq("status", "held")          // idempotency guard
    .select("id");

  if (resUpdateError) {
    return { success: false, error: `Failed to expire reservations: ${resUpdateError.message}` };
  }

  const expiredReservationIds = (updatedRes ?? []).map((r) => (r as { id: string }).id);

  // ── Step 3: move linked jobs to expired ───────────────────────────────────
  // Only transitions jobs still waiting for payment — confirmed / completed
  // / already-expired jobs are left alone (idempotency guard via .in()).
  const { data: updatedJobs, error: jobUpdateError } = await supabase
    .from("jobs")
    .update({ status: "expired", updated_at: now.toISOString() })
    .in("reservation_id", staleIds)
    .in("status", ["slot_held", "awaiting_payment"])  // idempotency guard
    .select("id");

  if (jobUpdateError) {
    return { success: false, error: `Failed to expire jobs: ${jobUpdateError.message}` };
  }

  const expiredJobIds = (updatedJobs ?? []).map((j) => (j as { id: string }).id);

  return { success: true, expiredReservationIds, expiredJobIds };
}
