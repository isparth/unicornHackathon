import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAvailableSlots,
  generateSlots,
  overlaps,
  SLOT_DURATION_MINUTES,
  SEARCH_HORIZON_HOURS,
} from "./scheduling-service";

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockData = {
  job?: Record<string, unknown> | null;
  workers?: Record<string, unknown>[];
  reservations?: Record<string, unknown>[];
  confirmedJobs?: Record<string, unknown>[];
  workerError?: { message: string } | null;
  reservationError?: { message: string } | null;
  confirmedJobError?: { message: string } | null;
};

let mockData: MockData = {};

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      const base = {
        select: () => base,
        eq: () => base,
        lt: () => base,
        gt: () => base,
        in: () => base,
        order: () => base,
        single: async () => {
          if (table === "jobs" && mockData.job !== undefined) {
            if (mockData.job === null) return { data: null, error: { message: "not found" } };
            return { data: mockData.job, error: null };
          }
          return { data: null, error: { message: "not found" } };
        },
      };

      // Override the terminal `.lt(...).gt(...)` chain for collection queries
      return {
        select: (_cols: string) => ({
          eq: (col: string, val: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (_c3: string, _v3: unknown) => ({
                lt: (_c4: string, _v4: unknown) => ({
                  gt: (_c5: string, _v5: unknown) => {
                    if (table === "workers") return Promise.resolve({ data: mockData.workers ?? [], error: mockData.workerError ?? null });
                    return Promise.resolve({ data: [], error: null });
                  },
                }),
                single: async () => ({ data: mockData.job, error: mockData.job ? null : { message: "not found" } }),
              }),
              lt: (_c: string, _v: unknown) => ({
                gt: (_c2: string, _v2: unknown) => ({
                  order: () => ({ data: [], error: null }),
                }),
              }),
            }),
            lt: (_c: string, _v: unknown) => ({
              gt: (_c2: string, _v2: unknown) => {
                // Distinguish tables
                if (table === "workers") return Promise.resolve({ data: mockData.workers ?? [], error: mockData.workerError ?? null });
                return Promise.resolve({ data: [], error: null });
              },
            }),
            single: async () => {
              if (table === "jobs") {
                if (mockData.job === null) return { data: null, error: { message: "not found" } };
                return { data: mockData.job ?? null, error: mockData.job ? null : { message: "not found" } };
              }
              return { data: null, error: null };
            },
          }),
          in: (_col: string, _vals: unknown[]) => ({
            in: (_c2: string, _v2: unknown[]) => ({
              lt: (_c: string, _v: unknown) => ({
                gt: (_c2: string, _v2: unknown) => {
                  if (table === "reservations") return Promise.resolve({ data: mockData.reservations ?? [], error: mockData.reservationError ?? null });
                  if (table === "jobs") return Promise.resolve({ data: mockData.confirmedJobs ?? [], error: mockData.confirmedJobError ?? null });
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            }),
            eq: (_c: string, _v: unknown) => ({
              lt: (_c2: string, _v2: unknown) => ({
                gt: (_c3: string, _v3: unknown) => {
                  if (table === "jobs") return Promise.resolve({ data: mockData.confirmedJobs ?? [], error: null });
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-01T09:00:00Z");
const JOB_ID = "job-sched-001";

const classifiedJob = {
  id: JOB_ID,
  required_skill: "heating",
  urgency: "same_day",
  service_business_id: "biz-001",
};

// A worker available 09:00–17:00 on the same day
function makeWorkerWithWindow(startsAt: string, endsAt: string) {
  return {
    id: "worker-001",
    name: "Amara Lewis",
    skill: "heating",
    active: true,
    availability_windows: [{ starts_at: startsAt, ends_at: endsAt }],
  };
}

// ─── Unit tests: pure helpers ──────────────────────────────────────────────────

describe("overlaps", () => {
  it("returns true when intervals completely overlap", () => {
    const a = new Date("2026-05-01T10:00:00Z");
    const b = new Date("2026-05-01T12:00:00Z");
    expect(overlaps(a, b, a, b)).toBe(true);
  });

  it("returns true when one interval contains the other", () => {
    const outer1 = new Date("2026-05-01T09:00:00Z");
    const outer2 = new Date("2026-05-01T17:00:00Z");
    const inner1 = new Date("2026-05-01T10:00:00Z");
    const inner2 = new Date("2026-05-01T12:00:00Z");
    expect(overlaps(outer1, outer2, inner1, inner2)).toBe(true);
  });

  it("returns true when intervals partially overlap", () => {
    const a1 = new Date("2026-05-01T10:00:00Z");
    const a2 = new Date("2026-05-01T13:00:00Z");
    const b1 = new Date("2026-05-01T12:00:00Z");
    const b2 = new Date("2026-05-01T15:00:00Z");
    expect(overlaps(a1, a2, b1, b2)).toBe(true);
  });

  it("returns false when intervals are adjacent (end = start)", () => {
    const a1 = new Date("2026-05-01T10:00:00Z");
    const a2 = new Date("2026-05-01T12:00:00Z");
    const b1 = new Date("2026-05-01T12:00:00Z");
    const b2 = new Date("2026-05-01T14:00:00Z");
    expect(overlaps(a1, a2, b1, b2)).toBe(false);
  });

  it("returns false when intervals are completely separate", () => {
    const a1 = new Date("2026-05-01T10:00:00Z");
    const a2 = new Date("2026-05-01T11:00:00Z");
    const b1 = new Date("2026-05-01T12:00:00Z");
    const b2 = new Date("2026-05-01T13:00:00Z");
    expect(overlaps(a1, a2, b1, b2)).toBe(false);
  });
});

describe("generateSlots", () => {
  const slotMs = SLOT_DURATION_MINUTES * 60 * 1000;

  it("generates 4 slots from an 8-hour window with 2-hour slots", () => {
    const start = new Date("2026-05-01T09:00:00Z");
    const end = new Date("2026-05-01T17:00:00Z");
    const earliest = start;
    const horizon = end;
    const slots = generateSlots(start, end, slotMs, earliest, horizon);
    expect(slots).toHaveLength(4);
  });

  it("slot start/end times are correct for 2-hour blocks", () => {
    const start = new Date("2026-05-01T09:00:00Z");
    const end = new Date("2026-05-01T17:00:00Z");
    const slots = generateSlots(start, end, slotMs, start, end);
    expect(slots[0].startsAt).toEqual(new Date("2026-05-01T09:00:00Z"));
    expect(slots[0].endsAt).toEqual(new Date("2026-05-01T11:00:00Z"));
    expect(slots[1].startsAt).toEqual(new Date("2026-05-01T11:00:00Z"));
    expect(slots[3].endsAt).toEqual(new Date("2026-05-01T17:00:00Z"));
  });

  it("excludes slots that start before earliest", () => {
    const windowStart = new Date("2026-05-01T09:00:00Z");
    const windowEnd = new Date("2026-05-01T17:00:00Z");
    const earliest = new Date("2026-05-01T11:00:00Z"); // skip first slot
    const slots = generateSlots(windowStart, windowEnd, slotMs, earliest, windowEnd);
    expect(slots).toHaveLength(3);
    expect(slots[0].startsAt).toEqual(new Date("2026-05-01T11:00:00Z"));
  });

  it("excludes slots that start after the horizon", () => {
    const windowStart = new Date("2026-05-01T09:00:00Z");
    const windowEnd = new Date("2026-05-01T17:00:00Z");
    const horizon = new Date("2026-05-01T13:00:00Z"); // only 2 slots fit
    const slots = generateSlots(windowStart, windowEnd, slotMs, windowStart, horizon);
    expect(slots).toHaveLength(2);
  });

  it("returns empty when window is too small for even one slot", () => {
    const start = new Date("2026-05-01T09:00:00Z");
    const end = new Date("2026-05-01T10:30:00Z"); // 90 min < 120 min slot
    const slots = generateSlots(start, end, slotMs, start, end);
    expect(slots).toHaveLength(0);
  });

  it("returns empty when earliest is past the window end", () => {
    const start = new Date("2026-05-01T09:00:00Z");
    const end = new Date("2026-05-01T17:00:00Z");
    const earliest = new Date("2026-05-01T18:00:00Z"); // after window
    const slots = generateSlots(start, end, slotMs, earliest, end);
    expect(slots).toHaveLength(0);
  });
});

describe("SEARCH_HORIZON_HOURS", () => {
  it("emergency horizon is 24 hours", () => {
    expect(SEARCH_HORIZON_HOURS.emergency).toBe(24);
  });

  it("same_day horizon is 48 hours", () => {
    expect(SEARCH_HORIZON_HOURS.same_day).toBe(48);
  });

  it("scheduled horizon is 14 days (336 hours)", () => {
    expect(SEARCH_HORIZON_HOURS.scheduled).toBe(14 * 24);
  });
});

// ─── Integration tests: getAvailableSlots ─────────────────────────────────────

beforeEach(() => {
  mockData = {};
  vi.clearAllMocks();
});

describe("getAvailableSlots", () => {
  it("returns not_found when job does not exist", async () => {
    mockData = { job: null };
    const result = await getAvailableSlots(JOB_ID, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("job_not_found");
  });

  it("returns not_classified when required_skill is null", async () => {
    mockData = { job: { ...classifiedJob, required_skill: null } };
    const result = await getAvailableSlots(JOB_ID, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_classified");
  });

  it("returns not_classified when urgency is null", async () => {
    mockData = { job: { ...classifiedJob, urgency: null } };
    const result = await getAvailableSlots(JOB_ID, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_classified");
  });

  it("returns empty slots when no workers have availability", async () => {
    mockData = { job: classifiedJob, workers: [] };
    const result = await getAvailableSlots(JOB_ID, NOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.slots).toHaveLength(0);
  });

  it("returns db_error when worker query fails", async () => {
    mockData = {
      job: classifiedJob,
      workers: [],
      workerError: { message: "connection timeout" },
    };
    const result = await getAvailableSlots(JOB_ID, NOW);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });
});

// ─── Slot generation with pure helpers (acceptance-level) ────────────────────

describe("Slot generation — pure acceptance", () => {
  const slotMs = SLOT_DURATION_MINUTES * 60 * 1000;

  it("generates 4 non-overlapping slots from a clean 8-hour window", () => {
    const windowStart = new Date("2026-05-01T09:00:00Z");
    const windowEnd = new Date("2026-05-01T17:00:00Z");
    const slots = generateSlots(windowStart, windowEnd, slotMs, NOW, windowEnd);
    expect(slots).toHaveLength(4);
    // Verify no adjacent slots overlap
    for (let i = 1; i < slots.length; i++) {
      expect(overlaps(
        slots[i - 1].startsAt, slots[i - 1].endsAt,
        slots[i].startsAt, slots[i].endsAt,
      )).toBe(false);
    }
  });

  it("emergency urgency uses 24h horizon", () => {
    const horizon = SEARCH_HORIZON_HOURS.emergency;
    expect(horizon).toBe(24);
    // 24 hours / 2 hours per slot = max 12 slots in a perfectly open window
    const windowStart = NOW;
    const windowEnd = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const horizonDate = new Date(NOW.getTime() + horizon * 60 * 60 * 1000);
    const slots = generateSlots(windowStart, windowEnd, slotMs, NOW, horizonDate);
    expect(slots).toHaveLength(12);
  });

  it("a 2-hour busy block removes exactly 1 slot", () => {
    const windowStart = new Date("2026-05-01T09:00:00Z");
    const windowEnd = new Date("2026-05-01T17:00:00Z");
    const allSlots = generateSlots(windowStart, windowEnd, slotMs, NOW, windowEnd);

    // Simulate a reservation from 11:00–13:00
    const busyStart = new Date("2026-05-01T11:00:00Z");
    const busyEnd = new Date("2026-05-01T13:00:00Z");

    const freeSlots = allSlots.filter(
      (s) => !overlaps(s.startsAt, s.endsAt, busyStart, busyEnd),
    );
    expect(freeSlots).toHaveLength(3);
  });

  it("a busy block that partially overlaps a slot removes that slot", () => {
    const windowStart = new Date("2026-05-01T09:00:00Z");
    const windowEnd = new Date("2026-05-01T17:00:00Z");
    const allSlots = generateSlots(windowStart, windowEnd, slotMs, NOW, windowEnd);

    // Reservation from 10:30–12:30 overlaps the 09:00–11:00 AND 11:00–13:00 slots
    const busyStart = new Date("2026-05-01T10:30:00Z");
    const busyEnd = new Date("2026-05-01T12:30:00Z");

    const freeSlots = allSlots.filter(
      (s) => !overlaps(s.startsAt, s.endsAt, busyStart, busyEnd),
    );
    expect(freeSlots).toHaveLength(2);
  });

  it("slots are sorted earliest-first", () => {
    const windowStart = new Date("2026-05-01T09:00:00Z");
    const windowEnd = new Date("2026-05-01T17:00:00Z");
    const slots = generateSlots(windowStart, windowEnd, slotMs, NOW, windowEnd);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].startsAt.getTime()).toBeGreaterThanOrEqual(
        slots[i - 1].startsAt.getTime(),
      );
    }
  });
});
