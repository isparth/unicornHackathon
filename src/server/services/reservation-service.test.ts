import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createReservation,
  releaseReservation,
  expireReservation,
  hasOverlappingReservation,
  getReservation,
  isHeldButExpired,
} from "./reservation-service";

// ─── Supabase mock ─────────────────────────────────────────────────────────────
//
// The reservation service chains queries like:
//   .from("reservations").select().eq().in().lt().gt()        — overlap check
//   .from("jobs").select().eq().eq().lt().gt()                — confirmed job check
//   .from("jobs").select().eq().single()                      — load job
//   .from("workers").select().eq().single()                   — load worker
//   .from("reservations").insert().select().single()          — create
//   .from("reservations").update().eq()                       — release/expire
//   .from("jobs").update().eq().eq()                          — clear slot
//
// We use a single chainable builder that terminates into async results keyed
// by table name so each level just returns `this`.

type MockState = {
  job?: Record<string, unknown> | null;
  existingReservation?: Record<string, unknown> | null;
  worker?: Record<string, unknown> | null;
  overlappingReservations?: Record<string, unknown>[];
  overlappingJobs?: Record<string, unknown>[];
  reservationForRelease?: Record<string, unknown> | null;
  /** Used by getReservation — takes priority over reservationForRelease */
  reservationById?: Record<string, unknown> | null;
  insertError?: { message: string; code?: string } | null;
  jobUpdateError?: { message: string } | null;
  resUpdateError?: { message: string } | null;
};

let state: MockState = {};
const capturedInserts: Record<string, unknown>[] = [];
const capturedUpdates: Record<string, unknown>[] = [];

/**
 * Build a chainable query object that resolves to the right data based on
 * `table` when the terminal method is called (.single() or await on query).
 */
function makeChain(table: string): Record<string, unknown> {
  // We need the chain to be thenable (for cases where it's awaited directly)
  // AND to return itself for every method so any chain depth works.
  const chain: Record<string, unknown> = {};

  const terminal = {
    /** Used by .select().eq()...single() */
    single: async () => {
      if (table === "jobs") {
        if (state.job === null) return { data: null, error: { message: "not found" } };
        return { data: state.job ?? null, error: state.job ? null : { message: "not found" } };
      }
      if (table === "workers") {
        if (state.worker === null) return { data: null, error: { message: "not found" } };
        return { data: state.worker ?? null, error: state.worker ? null : { message: "not found" } };
      }
      if (table === "reservations") {
        // reservationById takes priority (used by getReservation)
        // then existingReservation (idempotency check), then reservationForRelease
        const data =
          state.reservationById !== undefined
            ? state.reservationById
            : state.existingReservation !== undefined
              ? state.existingReservation
              : state.reservationForRelease;
        if (data === null || data === undefined) {
          return { data: null, error: { message: "not found" } };
        }
        return { data, error: null };
      }
      return { data: null, error: null };
    },
    /** Thenable — when the entire chain is awaited (overlap check queries) */
    then: (resolve: (v: unknown) => void) => {
      let data: unknown[] = [];
      if (table === "reservations") data = state.overlappingReservations ?? [];
      if (table === "jobs") data = state.overlappingJobs ?? [];
      resolve({ data, error: null });
    },
  };

  // Every chainable method returns the same chain object
  const methods = ["select", "eq", "in", "lt", "gt", "neq", "order", "limit"];
  for (const m of methods) {
    chain[m] = () => ({ ...chain, ...terminal });
  }
  return { ...chain, ...terminal };
}

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      const base = makeChain(table);

      return {
        ...base,
        insert: (data: unknown) => {
          capturedInserts.push(data as Record<string, unknown>);
          return {
            select: () => ({
              single: async () => {
                if (state.insertError) return { data: null, error: state.insertError };
                return {
                  data: {
                    id: "res-new-001",
                    job_id: "job-001",
                    worker_id: "worker-001",
                    status: "held",
                    starts_at: "2026-05-01T10:00:00Z",
                    ends_at: "2026-05-01T12:00:00Z",
                    expires_at: "2026-05-01T11:30:00Z",
                  },
                  error: null,
                };
              },
            }),
          };
        },
        update: (payload: unknown) => {
          capturedUpdates.push(payload as Record<string, unknown>);
          return {
            eq: (_col: string, _val: unknown) => ({
              eq: () => Promise.resolve({
                error: table === "jobs"
                  ? (state.jobUpdateError ?? null)
                  : (state.resUpdateError ?? null),
              }),
              neq: () => Promise.resolve({ error: null }),
              // Awaiting directly
              then: (resolve: (v: unknown) => void) =>
                resolve({ error: state.resUpdateError ?? null }),
            }),
          };
        },
      };
    },
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-01T09:00:00Z");
const JOB_ID = "job-res-001";
const WORKER_ID = "worker-001";
const SLOT_START = new Date("2026-05-01T10:00:00Z");
const SLOT_END = new Date("2026-05-01T12:00:00Z");

const pricedJob = { id: JOB_ID, status: "priced", reservation_id: null };
const activeWorker = { id: WORKER_ID, active: true };

beforeEach(() => {
  state = {};
  capturedInserts.length = 0;
  capturedUpdates.length = 0;
  vi.clearAllMocks();
});

// ─── createReservation ────────────────────────────────────────────────────────

describe("createReservation", () => {
  it("returns job_not_found when the job does not exist", async () => {
    state = { job: null };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("job_not_found");
  });

  it("returns invalid_job_state when job is in intake", async () => {
    state = { job: { ...pricedJob, status: "intake" } };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_job_state");
  });

  it("returns invalid_job_state when job is in qualified", async () => {
    state = { job: { ...pricedJob, status: "qualified" } };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_job_state");
  });

  it("returns worker_not_found when worker does not exist", async () => {
    state = { job: pricedJob, worker: null, overlappingReservations: [], overlappingJobs: [] };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("worker_not_found");
  });

  it("returns worker_inactive when worker is not active", async () => {
    state = { job: pricedJob, worker: { id: WORKER_ID, active: false }, overlappingReservations: [], overlappingJobs: [] };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("worker_inactive");
  });

  it("returns overlap_conflict when worker already has an active reservation in that slot", async () => {
    state = {
      job: pricedJob,
      worker: activeWorker,
      overlappingReservations: [{ id: "res-existing" }],
      overlappingJobs: [],
    };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("overlap_conflict");
  });

  it("returns overlap_conflict when a confirmed job occupies the slot", async () => {
    state = {
      job: pricedJob,
      worker: activeWorker,
      overlappingReservations: [],
      overlappingJobs: [{ id: "job-confirmed" }],
    };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("overlap_conflict");
  });

  it("creates the reservation successfully on happy path", async () => {
    state = { job: pricedJob, worker: activeWorker, overlappingReservations: [], overlappingJobs: [] };

    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reservation.status).toBe("held");
    expect(result.alreadyDone).toBe(false);
  });

  it("sets expires_at in the future", async () => {
    state = { job: pricedJob, worker: activeWorker, overlappingReservations: [], overlappingJobs: [] };

    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(new Date(result.reservation.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("writes reservation to DB with correct fields", async () => {
    state = { job: pricedJob, worker: activeWorker, overlappingReservations: [], overlappingJobs: [] };

    await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);

    expect(capturedInserts.length).toBeGreaterThan(0);
    const inserted = capturedInserts[0] as Record<string, unknown>;
    expect(inserted.job_id).toBe(JOB_ID);
    expect(inserted.worker_id).toBe(WORKER_ID);
    expect(inserted.status).toBe("held");
    expect(inserted.starts_at).toBe(SLOT_START.toISOString());
    expect(inserted.ends_at).toBe(SLOT_END.toISOString());
  });

  it("returns db_error when insert fails for non-overlap reason", async () => {
    state = {
      job: pricedJob,
      worker: activeWorker,
      overlappingReservations: [],
      overlappingJobs: [],
      insertError: { message: "foreign key violation" },
    };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });

  it("returns overlap_conflict when DB exclusion constraint fires (code 23P01)", async () => {
    state = {
      job: pricedJob,
      worker: activeWorker,
      overlappingReservations: [],
      overlappingJobs: [],
      insertError: { message: "no_overlapping_active_reservations", code: "23P01" },
    };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("overlap_conflict");
  });

  it("accepts slot_held job (idempotent re-selection)", async () => {
    state = {
      job: { ...pricedJob, status: "slot_held" },
      worker: activeWorker,
      overlappingReservations: [],
      overlappingJobs: [],
    };
    const result = await createReservation(JOB_ID, WORKER_ID, SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(true);
  });
});

// ─── releaseReservation ───────────────────────────────────────────────────────

describe("releaseReservation", () => {
  it("returns not_found when reservation does not exist", async () => {
    state = { reservationForRelease: null };
    const result = await releaseReservation("res-nonexistent", NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  it("releases successfully when reservation exists", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: JOB_ID, status: "held" },
    };
    const result = await releaseReservation("res-001", NOW);
    expect(result.success).toBe(true);
  });

  it("writes status=released to DB", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: JOB_ID, status: "held" },
    };
    await releaseReservation("res-001", NOW);
    const releaseUpdate = capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "released",
    );
    expect(releaseUpdate).toBeTruthy();
  });

  it("returns db_error when update fails", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: JOB_ID, status: "held" },
      resUpdateError: { message: "write failed" },
    };
    const result = await releaseReservation("res-001", NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });
});

// ─── expireReservation ────────────────────────────────────────────────────────

describe("expireReservation", () => {
  it("returns not_found when reservation does not exist", async () => {
    state = { reservationForRelease: null };
    const result = await expireReservation("res-nonexistent", NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  it("expires successfully when reservation exists", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: JOB_ID, status: "held" },
    };
    const result = await expireReservation("res-001", NOW);
    expect(result.success).toBe(true);
  });

  it("writes status=expired to DB", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: JOB_ID, status: "held" },
    };
    await expireReservation("res-001", NOW);
    const expireUpdate = capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "expired",
    );
    expect(expireUpdate).toBeTruthy();
  });
});

// ─── hasOverlappingReservation ────────────────────────────────────────────────

describe("hasOverlappingReservation", () => {
  it("returns true when overlapping reservations exist", async () => {
    state = {
      overlappingReservations: [{ id: "res-001", status: "held", expires_at: "2099-01-01T00:00:00Z" }],
      overlappingJobs: [],
    };
    const result = await hasOverlappingReservation(WORKER_ID, SLOT_START, SLOT_END);
    expect(result).toBe(true);
  });

  it("returns false when no overlapping reservations or jobs", async () => {
    state = { overlappingReservations: [], overlappingJobs: [] };
    const result = await hasOverlappingReservation(WORKER_ID, SLOT_START, SLOT_END);
    expect(result).toBe(false);
  });

  it("returns true when overlapping confirmed job exists", async () => {
    state = { overlappingReservations: [], overlappingJobs: [{ id: "job-conf" }] };
    const result = await hasOverlappingReservation(WORKER_ID, SLOT_START, SLOT_END);
    expect(result).toBe(true);
  });

  it("returns false when the only overlapping reservation is held but past its expires_at", async () => {
    // Reservation exists in DB with status=held but expired 1 hour ago
    const pastExpiry = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    state = {
      overlappingReservations: [{ id: "res-stale", status: "held", expires_at: pastExpiry }],
      overlappingJobs: [],
    };
    const result = await hasOverlappingReservation(WORKER_ID, SLOT_START, SLOT_END, undefined, NOW);
    expect(result).toBe(false);
  });

  it("returns true when a confirmed reservation is in the slot regardless of expires_at", async () => {
    // Confirmed reservations don't have a hold window — they should always block
    state = {
      overlappingReservations: [{ id: "res-conf", status: "confirmed", expires_at: "2000-01-01T00:00:00Z" }],
      overlappingJobs: [],
    };
    const result = await hasOverlappingReservation(WORKER_ID, SLOT_START, SLOT_END, undefined, NOW);
    expect(result).toBe(true);
  });
});

// ─── isHeldButExpired ─────────────────────────────────────────────────────────

describe("isHeldButExpired", () => {
  const baseReservation = {
    id: "res-001",
    jobId: JOB_ID,
    workerId: WORKER_ID,
    startsAt: SLOT_START.toISOString(),
    endsAt: SLOT_END.toISOString(),
  };

  it("returns true when status is held and expires_at is in the past", () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(isHeldButExpired({ ...baseReservation, status: "held", expiresAt: past }, NOW)).toBe(true);
  });

  it("returns false when status is held and expires_at is in the future", () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(isHeldButExpired({ ...baseReservation, status: "held", expiresAt: future }, NOW)).toBe(false);
  });

  it("returns false when status is confirmed even if expires_at is in the past", () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(isHeldButExpired({ ...baseReservation, status: "confirmed", expiresAt: past }, NOW)).toBe(false);
  });

  it("returns false when status is expired", () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(isHeldButExpired({ ...baseReservation, status: "expired", expiresAt: past }, NOW)).toBe(false);
  });
});

// ─── getReservation ───────────────────────────────────────────────────────────

describe("getReservation", () => {
  const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(); // 1h from now
  const PAST = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();   // 1h ago

  it("returns not_found when reservation does not exist", async () => {
    state = { reservationById: null };
    const result = await getReservation("res-nonexistent", NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  it("returns the reservation with wasLazilyExpired=false when held and not expired", async () => {
    state = {
      reservationById: {
        id: "res-001", job_id: JOB_ID, worker_id: WORKER_ID,
        status: "held", starts_at: SLOT_START.toISOString(),
        ends_at: SLOT_END.toISOString(), expires_at: FUTURE,
      },
    };
    const result = await getReservation("res-001", NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reservation.status).toBe("held");
    expect(result.wasLazilyExpired).toBe(false);
  });

  it("returns the reservation with status=expired and wasLazilyExpired=true when hold has passed", async () => {
    state = {
      reservationById: {
        id: "res-old", job_id: JOB_ID, worker_id: WORKER_ID,
        status: "held", starts_at: SLOT_START.toISOString(),
        ends_at: SLOT_END.toISOString(), expires_at: PAST,
      },
      // expireReservation will call .select().eq().single() for the same table
      // so reservationForRelease feeds it the record it needs
      reservationForRelease: {
        id: "res-old", job_id: JOB_ID, status: "held",
      },
    };
    const result = await getReservation("res-old", NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reservation.status).toBe("expired");
    expect(result.wasLazilyExpired).toBe(true);
  });

  it("returns wasLazilyExpired=false for a reservation already in expired status", async () => {
    state = {
      reservationById: {
        id: "res-already", job_id: JOB_ID, worker_id: WORKER_ID,
        status: "expired", starts_at: SLOT_START.toISOString(),
        ends_at: SLOT_END.toISOString(), expires_at: PAST,
      },
    };
    const result = await getReservation("res-already", NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reservation.status).toBe("expired");
    expect(result.wasLazilyExpired).toBe(false);
  });
});
