import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPaymentSession } from "./payment";

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockData = {
  job?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
};

let mockData: MockData = {};
let capturedJobUpdate: Record<string, unknown> | undefined;

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => {
            if (table === "jobs") {
              if (mockData.job === null) return { data: null, error: { message: "not found" } };
              return { data: mockData.job, error: null };
            }
            if (table === "customers") {
              if (mockData.customer === null) return { data: null, error: null };
              return { data: mockData.customer, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        if (table === "jobs") capturedJobUpdate = payload;
        return {
          eq: () =>
            Promise.resolve({ error: mockData.updateError ?? null }),
        };
      },
    }),
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID = "job-payment-test-001";
const CUSTOMER_ID = "cust-001";

const pricedJobWithFormDone = {
  id: JOB_ID,
  status: "priced",
  customer_id: CUSTOMER_ID,
  price_estimate: {
    calloutFeePence: 8000,
    currency: "gbp",
  },
  call_sessions: [
    {
      id: "sess-001",
      intake_form_completed_at: "2024-01-01T10:00:00Z",
      customer_id: CUSTOMER_ID,
    },
  ],
};

const fullCustomer = {
  name: "Jane Smith",
  address_line_1: "10 High Street",
  city: "London",
  postcode: "SW1A 1AA",
  phone_number: "+447911123456",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockData = {};
  capturedJobUpdate = undefined;
  vi.clearAllMocks();
});

describe("createPaymentSession — hard gate: intake form", () => {
  it("blocks payment when no call session has intake_form_completed_at set", async () => {
    mockData = {
      job: {
        ...pricedJobWithFormDone,
        call_sessions: [
          { id: "sess-001", intake_form_completed_at: null, customer_id: CUSTOMER_ID },
        ],
      },
      customer: fullCustomer,
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("intake_form_incomplete");
    expect(result.message).toMatch(/intake form/i);
  });

  it("blocks payment when call_sessions array is empty", async () => {
    mockData = {
      job: { ...pricedJobWithFormDone, call_sessions: [] },
      customer: fullCustomer,
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("intake_form_incomplete");
  });

  it("allows payment when intake_form_completed_at is set", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(true);
  });
});

describe("createPaymentSession — hard gate: job state", () => {
  it("blocks payment when job is in intake state", async () => {
    mockData = {
      job: { ...pricedJobWithFormDone, status: "intake" },
      customer: fullCustomer,
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_job_state");
    expect(result.message).toContain("intake");
  });

  it("blocks payment when job is in qualified state", async () => {
    mockData = {
      job: { ...pricedJobWithFormDone, status: "qualified" },
      customer: fullCustomer,
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_job_state");
  });

  it("allows payment for priced jobs", async () => {
    mockData = { job: { ...pricedJobWithFormDone, status: "priced" }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
  });

  it("allows payment for slot_held jobs", async () => {
    mockData = { job: { ...pricedJobWithFormDone, status: "slot_held" }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
  });

  it("allows payment for awaiting_payment jobs (idempotent)", async () => {
    mockData = {
      job: { ...pricedJobWithFormDone, status: "awaiting_payment" },
      customer: fullCustomer,
    };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
  });
});

describe("createPaymentSession — hard gate: customer fields", () => {
  it("blocks payment when customer name is missing", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: { ...fullCustomer, name: null },
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
    expect(result.message).toContain("name");
  });

  it("blocks payment when address is missing", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: { ...fullCustomer, address_line_1: null },
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
    expect(result.message).toContain("address");
  });

  it("blocks payment when city is missing", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: { ...fullCustomer, city: null },
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
    expect(result.message).toContain("city");
  });

  it("blocks payment when postcode is missing", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: { ...fullCustomer, postcode: null },
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
    expect(result.message).toContain("postcode");
  });

  it("lists all missing fields in one error", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: { ...fullCustomer, name: null, city: null },
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
    expect(result.message).toContain("name");
    expect(result.message).toContain("city");
  });
});

describe("createPaymentSession — happy path", () => {
  it("returns success with a paymentUrl", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.paymentUrl).toBeTruthy();
    expect(result.jobId).toBe(JOB_ID);
  });

  it("returns the callout fee amount from the price estimate", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.amountPence).toBe(8000);
    expect(result.currency).toBe("gbp");
  });

  it("advances the job to awaiting_payment when in priced state", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };

    await createPaymentSession(JOB_ID);

    expect(capturedJobUpdate?.status).toBe("awaiting_payment");
  });

  it("does NOT update job status when already awaiting_payment", async () => {
    mockData = {
      job: { ...pricedJobWithFormDone, status: "awaiting_payment" },
      customer: fullCustomer,
    };

    await createPaymentSession(JOB_ID);

    // No DB write should happen for status
    expect(capturedJobUpdate).toBeUndefined();
  });

  it("returns job_not_found when the job does not exist", async () => {
    mockData = { job: null };

    const result = await createPaymentSession("nonexistent");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("job_not_found");
  });

  it("returns db_error when the DB update fails", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: fullCustomer,
      updateError: { message: "write failed" },
    };

    const result = await createPaymentSession(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });
});
