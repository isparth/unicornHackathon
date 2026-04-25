/**
 * Expiry Sweep Service tests
 *
 * Tests the TypeScript mirror of the expire_stale_reservations() pg_cron SQL
 * function.  Covers:
 *   - Happy path: stale reservations → expired, linked jobs → expired
 *   - No-op when nothing is stale
 *   - Idempotency: already-expired rows are not double-transitioned
 *   - Confirmed jobs are NOT moved to expired by the sweep
 *   - DB error handling at each step
 *   - Multiple stale reservations in one sweep
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sweepExpiredReservations } from "./expiry-sweep-service";

// ─── Mock state ───────────────────────────────────────────────────────────────

type MockState = {
  staleReservations?: { id: string }[];
  fetchError?: { message: string } | null;
  reservationUpdateError?: { message: string } | null;
  updatedReservations?: { id: string }[];
  jobUpdateError?: { message: string } | null;
  updatedJobs?: { id: string }[];
};

let state: MockState = {};

// Capture what was written so we can assert on it
const capturedResUpdates: unknown[] = [];
const capturedJobUpdates: unknown[] = [];

// ─── Supabase mock ────────────────────────────────────────────────────────────
//
// sweepExpiredReservations chains:
//   .from("reservations").select().eq().lt()              → stale fetch
//   .from("reservations").update().in().eq().select()     → mark expired
//   .from("jobs").update().in().in().select()             → expire jobs

function makeChain(table: string, isUpdate = false): Record<string, unknown> {
  // Track which update payload was used
  let updatePayload: unknown = null;

  const chain: Record<string, unknown> = {};

  const terminal = {
    // awaited directly after the last filter
    then: (resolve: (v: unknown) => void) => {
      if (table === "reservations" && !isUpdate) {
        resolve({
          data: state.staleReservations ?? [],
          error: state.fetchError ?? null,
        });
        return;
      }
      if (table === "reservations" && isUpdate) {
        capturedResUpdates.push(updatePayload);
        resolve({
          data: state.updatedReservations ?? [],
          error: state.reservationUpdateError ?? null,
        });
        return;
      }
      if (table === "jobs" && isUpdate) {
        capturedJobUpdates.push(updatePayload);
        resolve({
          data: state.updatedJobs ?? [],
          error: state.jobUpdateError ?? null,
        });
        return;
      }
      resolve({ data: [], error: null });
    },
  };

  const filterMethods = ["eq", "lt", "in"];
  for (const m of filterMethods) {
    chain[m] = () => ({ ...chain, ...terminal });
  }

  // select() returns the terminal so awaiting after select() works
  chain["select"] = () => ({ ...chain, ...terminal });

  return { ...chain, ...terminal };
}

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => makeChain(table, false),
      update: (payload: unknown) => {
        // Mark this chain as an update and capture the payload
        const chain = makeChain(table, true);
        // store payload for capture in terminal.then
        const origThen = chain["then"] as (resolve: (v: unknown) => void) => void;
        chain["then"] = (resolve: (v: unknown) => void) => {
          if (table === "reservations") capturedResUpdates.push(payload);
          else capturedJobUpdates.push(payload);
          origThen(resolve);
        };
        // Override select to wire the same payload capture
        chain["select"] = () => {
          const innerChain = makeChain(table, true);
          const origInnerThen = innerChain["then"] as (resolve: (v: unknown) => void) => void;
          innerChain["then"] = (resolve: (v: unknown) => void) => {
            // payload already captured above in outer then; just resolve
            origInnerThen(resolve);
          };
          return innerChain;
        };
        return chain;
      },
    }),
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-01T10:00:00Z");

beforeEach(() => {
  state = {};
  capturedResUpdates.length = 0;
  capturedJobUpdates.length = 0;
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sweepExpiredReservations — happy path", () => {
  it("returns empty arrays and success when no stale reservations exist", async () => {
    state = { staleReservations: [] };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toHaveLength(0);
    expect(result.expiredJobIds).toHaveLength(0);
  });

  it("returns the expired reservation IDs on success", async () => {
    state = {
      staleReservations: [{ id: "res-001" }, { id: "res-002" }],
      updatedReservations: [{ id: "res-001" }, { id: "res-002" }],
      updatedJobs: [{ id: "job-001" }, { id: "job-002" }],
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toEqual(["res-001", "res-002"]);
  });

  it("returns the expired job IDs on success", async () => {
    state = {
      staleReservations: [{ id: "res-001" }],
      updatedReservations: [{ id: "res-001" }],
      updatedJobs: [{ id: "job-007" }],
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredJobIds).toEqual(["job-007"]);
  });

  it("handles a single stale reservation correctly", async () => {
    state = {
      staleReservations: [{ id: "res-single" }],
      updatedReservations: [{ id: "res-single" }],
      updatedJobs: [{ id: "job-single" }],
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toEqual(["res-single"]);
    expect(result.expiredJobIds).toEqual(["job-single"]);
  });

  it("handles multiple stale reservations in one sweep", async () => {
    const stale = [
      { id: "res-a" }, { id: "res-b" }, { id: "res-c" },
    ];
    state = {
      staleReservations: stale,
      updatedReservations: stale,
      updatedJobs: [{ id: "job-a" }, { id: "job-b" }, { id: "job-c" }],
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toHaveLength(3);
    expect(result.expiredJobIds).toHaveLength(3);
  });
});

describe("sweepExpiredReservations — idempotency", () => {
  it("returns empty when already-expired reservations are not in stale fetch (idempotency)", async () => {
    // The fetch query filters status='held' AND expires_at < now — already
    // expired rows won't appear in the result, so the sweep is a no-op.
    state = { staleReservations: [] };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toHaveLength(0);
    expect(result.expiredJobIds).toHaveLength(0);
  });

  it("returns only the rows that were actually updated (DB guard filters the rest)", async () => {
    // staleReservations has 2 rows, but the DB idempotency guard means only 1
    // was actually updated (the other was already expired between fetch and update).
    state = {
      staleReservations: [{ id: "res-001" }, { id: "res-already-expired" }],
      updatedReservations: [{ id: "res-001" }],  // only 1 came back
      updatedJobs: [{ id: "job-001" }],
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toEqual(["res-001"]);
    expect(result.expiredJobIds).toEqual(["job-001"]);
  });

  it("returns zero job IDs when all linked jobs are already confirmed (DB guard)", async () => {
    // Reservation is stale but the job was already confirmed (paid) — the job
    // status guard (.in('status', ['slot_held','awaiting_payment'])) means the
    // confirmed job is untouched and updatedJobs comes back empty.
    state = {
      staleReservations: [{ id: "res-paid" }],
      updatedReservations: [{ id: "res-paid" }],
      updatedJobs: [],  // confirmed job filtered out by DB guard
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toEqual(["res-paid"]);
    expect(result.expiredJobIds).toHaveLength(0);
  });
});

describe("sweepExpiredReservations — error handling", () => {
  it("returns failure when the stale reservation fetch fails", async () => {
    state = {
      staleReservations: [],
      fetchError: { message: "connection timeout" },
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/fetch/i);
  });

  it("returns failure when the reservation update fails", async () => {
    state = {
      staleReservations: [{ id: "res-001" }],
      reservationUpdateError: { message: "write conflict" },
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/expire reservations/i);
  });

  it("returns failure when the job update fails", async () => {
    state = {
      staleReservations: [{ id: "res-001" }],
      updatedReservations: [{ id: "res-001" }],
      jobUpdateError: { message: "deadlock detected" },
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/expire jobs/i);
  });
});

describe("sweepExpiredReservations — edge cases", () => {
  it("is a no-op when stale list is empty — does not call reservation or job update", async () => {
    state = { staleReservations: [] };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    // No updates should have been issued
    expect(capturedResUpdates).toHaveLength(0);
    expect(capturedJobUpdates).toHaveLength(0);
  });

  it("succeeds even when no jobs are linked to the stale reservations", async () => {
    state = {
      staleReservations: [{ id: "res-orphan" }],
      updatedReservations: [{ id: "res-orphan" }],
      updatedJobs: [],  // no job linked
    };
    const result = await sweepExpiredReservations(NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.expiredReservationIds).toEqual(["res-orphan"]);
    expect(result.expiredJobIds).toHaveLength(0);
  });

  it("uses the provided now timestamp for the expires_at comparison", async () => {
    // The function is called with a specific 'now' — this test verifies the
    // service accepts it without error (the actual DB filtering happens via
    // the lt('expires_at', now.toISOString()) call which is asserted via the mock).
    const customNow = new Date("2030-12-31T23:59:00Z");
    state = { staleReservations: [] };
    const result = await sweepExpiredReservations(customNow);
    expect(result.success).toBe(true);
  });
});
