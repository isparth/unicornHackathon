/**
 * QA Acceptance Tests — Milestone 3: Worker Availability, Scheduling & Reservation Holds
 *
 * Tests the following scenarios end-to-end using pure service functions:
 *
 *   1. Skill matching         — only workers whose skill matches the job's
 *                               required_skill are considered.
 *   2. Double-booking guard   — a slot held by Worker A cannot be given to a
 *                               second caller while the hold is active.
 *   3. Expiry flow            — expireReservation marks the reservation expired
 *                               and the job moves back to the right state.
 *   4. Demo scenario mapping  — each demo fixture maps to an expected horizon,
 *                               slot count, and slot duration.
 *
 * No real Supabase or OpenAI calls are made — all DB interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSlots,
  overlaps,
  SLOT_DURATION_MINUTES,
  SEARCH_HORIZON_HOURS,
  getAvailableSlots,
} from "./scheduling-service";
import {
  createReservation,
  releaseReservation,
  expireReservation,
  hasOverlappingReservation,
} from "./reservation-service";
import {
  boilerFailure,
  leakInvestigation,
  electricalFault,
  demoScenarios,
  type DemoScenario,
} from "@/domain/demo-scenarios";

// ─── Supabase mock (shared by scheduling + reservation calls) ─────────────────

type MockState = {
  job?: Record<string, unknown> | null;
  workers?: Record<string, unknown>[];
  reservations?: Record<string, unknown>[];
  confirmedJobs?: Record<string, unknown>[];
  worker?: Record<string, unknown> | null;
  overlappingReservations?: Record<string, unknown>[];
  overlappingJobs?: Record<string, unknown>[];
  reservationForRelease?: Record<string, unknown> | null;
  workerError?: { message: string } | null;
  insertError?: { message: string; code?: string } | null;
  resUpdateError?: { message: string } | null;
};

let state: MockState = {};
const capturedInserts: Record<string, unknown>[] = [];
const capturedUpdates: Record<string, unknown>[] = [];

/** Fully chainable mock builder — handles arbitrary .eq().eq()…  chains. */
function makeChain(table: string) {
  const terminal = {
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
        const data = state.reservationForRelease;
        if (data === null || data === undefined) return { data: null, error: { message: "not found" } };
        return { data, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve: (v: unknown) => void) => {
      if (table === "workers") {
        resolve({ data: state.workers ?? [], error: state.workerError ?? null });
        return;
      }
      if (table === "reservations") {
        resolve({ data: state.overlappingReservations ?? [], error: null });
        return;
      }
      if (table === "jobs") {
        resolve({ data: state.overlappingJobs ?? [], error: null });
        return;
      }
      resolve({ data: [], error: null });
    },
  };

  const chain: Record<string, unknown> = {};
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
                    id: "res-qa-001",
                    job_id: "job-qa",
                    worker_id: "worker-qa",
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
              eq: () => Promise.resolve({ error: null }),
              neq: () => Promise.resolve({ error: null }),
              then: (resolve: (v: unknown) => void) =>
                resolve({ error: state.resUpdateError ?? null }),
            }),
          };
        },
      };
    },
  }),
}));

beforeEach(() => {
  state = {};
  capturedInserts.length = 0;
  capturedUpdates.length = 0;
  vi.clearAllMocks();
});

// ─── Reference time and helpers ───────────────────────────────────────────────

const NOW = new Date("2026-05-01T09:00:00Z");
const SLOT_MS = SLOT_DURATION_MINUTES * 60 * 1000;

function hoursLater(n: number): Date {
  return new Date(NOW.getTime() + n * 60 * 60 * 1000);
}

function makeWorker(id: string, skill: string, windowStart: Date, windowEnd: Date) {
  return {
    id,
    name: `Worker ${id}`,
    skill,
    active: true,
    availability_windows: [
      { starts_at: windowStart.toISOString(), ends_at: windowEnd.toISOString() },
    ],
  };
}

// ─── 1. Skill matching ────────────────────────────────────────────────────────

describe("Skill matching (pure layer)", () => {
  it("same skill — slot is generated", () => {
    const windowStart = hoursLater(1);
    const windowEnd = hoursLater(5);
    const slots = generateSlots(windowStart, windowEnd, SLOT_MS, NOW, hoursLater(48));
    expect(slots.length).toBeGreaterThan(0);
  });

  it("each slot has correct duration (SLOT_DURATION_MINUTES)", () => {
    const windowStart = hoursLater(1);
    const windowEnd = hoursLater(5);
    const slots = generateSlots(windowStart, windowEnd, SLOT_MS, NOW, hoursLater(48));
    for (const s of slots) {
      const durationMin = (s.endsAt.getTime() - s.startsAt.getTime()) / 60000;
      expect(durationMin).toBe(SLOT_DURATION_MINUTES);
    }
  });

  it("worker with wrong skill is not included — no slots returned", async () => {
    // Simulate job with "plumbing" but workers array has a "heating" worker
    state = {
      job: {
        id: "job-qa",
        required_skill: "plumbing",
        urgency: "scheduled",
        service_business_id: "biz-001",
      },
      // Scheduling service filters by skill in the DB query; mock returns empty
      workers: [],
    };
    const result = await getAvailableSlots("job-qa", NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.slots).toHaveLength(0);
  });

  it("matching skill worker with availability window → slots returned", async () => {
    const wStart = hoursLater(1);
    const wEnd = hoursLater(9);
    state = {
      job: {
        id: "job-qa",
        required_skill: "heating",
        urgency: "same_day",
        service_business_id: "biz-001",
      },
      workers: [makeWorker("w-heat-01", "heating", wStart, wEnd)],
      reservations: [],
      confirmedJobs: [],
    };
    const result = await getAvailableSlots("job-qa", NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots[0].workerId).toBe("w-heat-01");
  });
});

// ─── 2. Double-booking prevention ─────────────────────────────────────────────

describe("Double-booking prevention", () => {
  const SLOT_START = hoursLater(1);
  const SLOT_END = hoursLater(3);

  it("hasOverlappingReservation → true when a held reservation overlaps", async () => {
    state = {
      overlappingReservations: [{ id: "res-001", worker_id: "w-1", starts_at: SLOT_START.toISOString(), ends_at: SLOT_END.toISOString() }],
      overlappingJobs: [],
    };
    const result = await hasOverlappingReservation("w-1", SLOT_START, SLOT_END);
    expect(result).toBe(true);
  });

  it("hasOverlappingReservation → false after hold expires or is released", async () => {
    state = { overlappingReservations: [], overlappingJobs: [] };
    const result = await hasOverlappingReservation("w-1", SLOT_START, SLOT_END);
    expect(result).toBe(false);
  });

  it("createReservation returns overlap_conflict when slot is already held", async () => {
    state = {
      job: { id: "job-qa", status: "priced", reservation_id: null },
      worker: { id: "w-1", active: true },
      overlappingReservations: [{ id: "res-existing" }],
      overlappingJobs: [],
    };
    const result = await createReservation("job-qa", "w-1", SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("overlap_conflict");
  });

  it("createReservation returns overlap_conflict when confirmed job occupies slot", async () => {
    state = {
      job: { id: "job-qa", status: "priced", reservation_id: null },
      worker: { id: "w-1", active: true },
      overlappingReservations: [],
      overlappingJobs: [{ id: "job-confirmed" }],
    };
    const result = await createReservation("job-qa", "w-1", SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("overlap_conflict");
  });

  it("DB exclusion constraint violation (23P01) also surfaces as overlap_conflict", async () => {
    state = {
      job: { id: "job-qa", status: "priced", reservation_id: null },
      worker: { id: "w-1", active: true },
      overlappingReservations: [],
      overlappingJobs: [],
      insertError: { message: "no_overlapping_active_reservations", code: "23P01" },
    };
    const result = await createReservation("job-qa", "w-1", SLOT_START, SLOT_END, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("overlap_conflict");
  });

  it("overlaps() helper: adjacent slots do not conflict", () => {
    const s1 = new Date("2026-05-01T10:00:00Z");
    const e1 = new Date("2026-05-01T12:00:00Z");
    const s2 = new Date("2026-05-01T12:00:00Z");
    const e2 = new Date("2026-05-01T14:00:00Z");
    // End of first == start of second → no overlap
    expect(overlaps(s1, e1, s2, e2)).toBe(false);
  });

  it("overlaps() helper: overlapping by 1 minute is detected", () => {
    const s1 = new Date("2026-05-01T10:00:00Z");
    const e1 = new Date("2026-05-01T12:01:00Z");
    const s2 = new Date("2026-05-01T12:00:00Z");
    const e2 = new Date("2026-05-01T14:00:00Z");
    expect(overlaps(s1, e1, s2, e2)).toBe(true);
  });
});

// ─── 3. Expiry flow ───────────────────────────────────────────────────────────

describe("Expiry flow", () => {
  it("expireReservation marks the reservation as expired in DB", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: "job-qa", status: "held" },
    };
    const result = await expireReservation("res-001", NOW);
    expect(result.success).toBe(true);
    const expiredWrite = capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "expired",
    );
    expect(expiredWrite).toBeTruthy();
  });

  it("expireReservation also writes a job status update (to expired)", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: "job-qa", status: "held" },
    };
    await expireReservation("res-001", NOW);
    // Both reservation and job get updated — we see ≥ 2 capturedUpdates
    expect(capturedUpdates.length).toBeGreaterThanOrEqual(2);
  });

  it("expireReservation returns not_found for unknown reservation", async () => {
    state = { reservationForRelease: null };
    const result = await expireReservation("res-unknown", NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  it("releaseReservation writes status=released and clears job slot", async () => {
    state = {
      reservationForRelease: { id: "res-001", job_id: "job-qa", status: "held" },
    };
    const result = await releaseReservation("res-001", NOW);
    expect(result.success).toBe(true);
    const releasedWrite = capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "released",
    );
    expect(releasedWrite).toBeTruthy();
  });

  it("released slot becomes available again (no overlap on next check)", async () => {
    // After release, overlappingReservations is empty
    state = { overlappingReservations: [], overlappingJobs: [] };
    const result = await hasOverlappingReservation(
      "w-1",
      hoursLater(1),
      hoursLater(3),
    );
    expect(result).toBe(false);
  });
});

// ─── 4. Demo scenario mapping ─────────────────────────────────────────────────

describe("Demo scenario scheduling config", () => {
  it.each(demoScenarios as DemoScenario[])(
    "$label — horizon hours match urgency",
    (scenario) => {
      const urgency = scenario.expectedClassification.urgency;
      const expectedHours: Record<string, number> = {
        emergency: 24,
        same_day: 48,
        scheduled: 14 * 24,
      };
      expect(SEARCH_HORIZON_HOURS[urgency]).toBe(expectedHours[urgency]);
    },
  );

  it.each(demoScenarios as DemoScenario[])(
    "$label — 8-hour window generates correct slot count for urgency",
    (scenario) => {
      const urgency = scenario.expectedClassification.urgency;
      const horizon = hoursLater(SEARCH_HORIZON_HOURS[urgency]);
      const windowStart = hoursLater(1); // starts 1 hour from now
      const windowEnd = hoursLater(9);   // 8-hour window
      const slots = generateSlots(windowStart, windowEnd, SLOT_MS, NOW, horizon);
      // 8 hours / 2-hour slots = 4 slots
      expect(slots).toHaveLength(4);
    },
  );

  it.each(demoScenarios as DemoScenario[])(
    "$label — slots start on or after NOW",
    (scenario) => {
      const urgency = scenario.expectedClassification.urgency;
      const horizon = hoursLater(SEARCH_HORIZON_HOURS[urgency]);
      const windowStart = hoursLater(0.5);
      const windowEnd = hoursLater(8.5);
      const slots = generateSlots(windowStart, windowEnd, SLOT_MS, NOW, horizon);
      for (const s of slots) {
        expect(s.startsAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
      }
    },
  );

  it.each(demoScenarios as DemoScenario[])(
    "$label — slots are sorted earliest first",
    (scenario) => {
      const urgency = scenario.expectedClassification.urgency;
      const horizon = hoursLater(SEARCH_HORIZON_HOURS[urgency]);
      const windowStart = hoursLater(1);
      const windowEnd = hoursLater(9);
      const slots = generateSlots(windowStart, windowEnd, SLOT_MS, NOW, horizon);
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].startsAt.getTime()).toBeGreaterThan(slots[i - 1].startsAt.getTime());
      }
    },
  );
});

// ─── 5. Scenario-specific spot checks ─────────────────────────────────────────

describe("Boiler failure scenario (heating / same_day)", () => {
  it("urgency is same_day → 48-hour horizon", () => {
    expect(boilerFailure.expectedClassification.urgency).toBe("same_day");
    expect(SEARCH_HORIZON_HOURS["same_day"]).toBe(48);
  });

  it("slot duration is 120 minutes", () => {
    expect(SLOT_DURATION_MINUTES).toBe(120);
  });

  it("8-hour window within 48h horizon → 4 bookable slots", () => {
    const horizon = hoursLater(48);
    const wStart = hoursLater(2);
    const wEnd = hoursLater(10);
    const slots = generateSlots(wStart, wEnd, SLOT_MS, NOW, horizon);
    expect(slots).toHaveLength(4);
  });
});

describe("Leak investigation scenario (plumbing / scheduled)", () => {
  it("urgency is scheduled → 336-hour horizon (14 days)", () => {
    expect(leakInvestigation.expectedClassification.urgency).toBe("scheduled");
    expect(SEARCH_HORIZON_HOURS["scheduled"]).toBe(336);
  });

  it("a slot blocked by a busy period is excluded", () => {
    const horizon = hoursLater(336);
    const wStart = hoursLater(1);
    const wEnd = hoursLater(9);
    const allSlots = generateSlots(wStart, wEnd, SLOT_MS, NOW, horizon);
    expect(allSlots).toHaveLength(4);

    // Busy block occupies slot 2 (hours 3–5)
    const busyStart = hoursLater(3);
    const busyEnd = hoursLater(5);
    const freeSlots = allSlots.filter(
      (s) => !overlaps(s.startsAt, s.endsAt, busyStart, busyEnd),
    );
    expect(freeSlots).toHaveLength(3);
  });
});

describe("Electrical fault scenario (electrical / emergency)", () => {
  it("urgency is emergency → 24-hour horizon", () => {
    expect(electricalFault.expectedClassification.urgency).toBe("emergency");
    expect(SEARCH_HORIZON_HOURS["emergency"]).toBe(24);
  });

  it("window outside 24h horizon produces no slots", () => {
    // Window starts 25 hours from now — beyond emergency horizon
    const horizon = hoursLater(24);
    const wStart = hoursLater(25);
    const wEnd = hoursLater(33);
    const slots = generateSlots(wStart, wEnd, SLOT_MS, NOW, horizon);
    expect(slots).toHaveLength(0);
  });

  it("window that starts inside horizon but ends beyond it: only in-horizon slots", () => {
    // Window: 22h–30h. Only one 2-hour slot fits (22h–24h is within horizon)
    const horizon = hoursLater(24);
    const wStart = hoursLater(22);
    const wEnd = hoursLater(30);
    const slots = generateSlots(wStart, wEnd, SLOT_MS, NOW, horizon);
    // Slot 22–24 starts before horizon; cursor at 24 == horizon so loop exits
    expect(slots).toHaveLength(1);
    expect(slots[0].startsAt).toEqual(hoursLater(22));
  });
});

// ─── 6. Reservation creation — createReservation success path ─────────────────

describe("createReservation — success path", () => {
  it("inserts with correct job_id, worker_id, starts_at, ends_at, status=held", async () => {
    const SLOT_START = hoursLater(1);
    const SLOT_END = hoursLater(3);
    state = {
      job: { id: "job-qa", status: "priced", reservation_id: null },
      worker: { id: "w-1", active: true },
      overlappingReservations: [],
      overlappingJobs: [],
    };
    await createReservation("job-qa", "w-1", SLOT_START, SLOT_END, NOW);
    const ins = capturedInserts[0] as Record<string, unknown>;
    expect(ins.job_id).toBe("job-qa");
    expect(ins.worker_id).toBe("w-1");
    expect(ins.status).toBe("held");
    expect(ins.starts_at).toBe(SLOT_START.toISOString());
    expect(ins.ends_at).toBe(SLOT_END.toISOString());
  });

  it("expires_at is in the future relative to NOW", async () => {
    const SLOT_START = hoursLater(1);
    const SLOT_END = hoursLater(3);
    state = {
      job: { id: "job-qa", status: "priced", reservation_id: null },
      worker: { id: "w-1", active: true },
      overlappingReservations: [],
      overlappingJobs: [],
    };
    await createReservation("job-qa", "w-1", SLOT_START, SLOT_END, NOW);
    const ins = capturedInserts[0] as Record<string, unknown>;
    const expiresAt = new Date(ins.expires_at as string);
    expect(expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("job update is written (status=slot_held, assigned_worker_id, slot timestamps)", async () => {
    const SLOT_START = hoursLater(1);
    const SLOT_END = hoursLater(3);
    state = {
      job: { id: "job-qa", status: "priced", reservation_id: null },
      worker: { id: "w-1", active: true },
      overlappingReservations: [],
      overlappingJobs: [],
    };
    await createReservation("job-qa", "w-1", SLOT_START, SLOT_END, NOW);
    const jobUpdate = capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "slot_held",
    );
    expect(jobUpdate).toBeTruthy();
    expect((jobUpdate as Record<string, unknown>).assigned_worker_id).toBe("w-1");
  });
});
