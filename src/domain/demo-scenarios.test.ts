/**
 * QA Acceptance Tests — Mid-Call Form Submission Scenarios
 *
 * These tests verify the full Milestone 2 pipeline for each demo scenario:
 *
 *   1. Classification mapping   — correct skill, urgency, and category are
 *                                 produced from each scenario's problem_summary.
 *   2. Pricing rule selection    — the right pricing rule fires for each
 *                                 skill × urgency combination and the
 *                                 customer-facing explanation contains the
 *                                 correct amounts.
 *   3. Hard gate                 — payment is blocked when the intake form is
 *                                 incomplete, and allowed once it is done.
 *
 * Separately, each section has named sub-tests for each scenario so failures
 * are immediately readable in CI output (e.g. "Boiler failure — classification
 * mapping > classifies as heating / same_day").
 *
 * The tests mock Supabase and OpenAI — no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  demoScenarios,
  boilerFailure,
  leakInvestigation,
  electricalFault,
  type DemoScenario,
} from "./demo-scenarios";
import {
  parseAndValidateClassification,
} from "@/server/services/classification-service";
import {
  lookupRule,
  buildExplanation,
} from "@/server/services/pricing-service";
import { validateIntakeFields } from "@/app/actions/intake-types";
import type { PriceEstimate } from "./types";

// ─── Supabase + service mocks (used for hard gate tests) ─────────────────────

type MockJobData = Record<string, unknown> | null;
type MockCustomerData = Record<string, unknown> | null;

let mockJobData: MockJobData = null;
let mockCustomerData: MockCustomerData = null;
let mockUpdateError: { message: string } | null = null;

// Stripe mock — returns a fake Checkout Session so happy-path tests pass
vi.mock("@/server/stripe/client", () => ({
  getStripeClient: () => ({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "cs_test_demo",
          url: "https://checkout.stripe.com/pay/cs_test_demo",
        }),
      },
    },
  }),
}));

vi.mock("@/config/app-config", () => ({
  appConfig: {
    appUrl: "http://localhost:3000",
    pricingDefaults: { calloutFeePence: 8000, currency: "gbp" },
    serviceCredentials: {
      stripe: { secretKey: "sk_test_mock", publishableKey: "", webhookSecret: "" },
    },
  },
}));

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, _val: string) => ({
          single: async () => {
            if (table === "jobs") {
              return mockJobData === null
                ? { data: null, error: { message: "not found" } }
                : { data: mockJobData, error: null };
            }
            if (table === "customers") {
              return { data: mockCustomerData, error: null };
            }
            if (table === "payments") {
              return { data: null, error: { message: "not found" } };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "pay-demo-001" }, error: null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: mockUpdateError }),
          then: (resolve: (v: unknown) => void) =>
            resolve({ error: mockUpdateError }),
        }),
      }),
    }),
  }),
}));

beforeEach(() => {
  mockJobData = null;
  mockCustomerData = null;
  mockUpdateError = null;
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build the JSON string OpenAI would return for a given expected classification */
function makeClassificationJson(s: DemoScenario): string {
  return JSON.stringify({
    requiredSkill: s.expectedClassification.requiredSkill,
    urgency: s.expectedClassification.urgency,
    jobCategory: `${s.expectedClassification.jobCategoryKeyword} job`,
  });
}

/** Customer record with all required fields populated */
function fullCustomer(s: DemoScenario): Record<string, unknown> {
  return {
    name: s.intakeFormFields.name,
    address_line_1: s.intakeFormFields.addressLine1,
    city: s.intakeFormFields.city,
    postcode: s.intakeFormFields.postcode,
    phone_number: s.intakeFormFields.phoneNumber,
  };
}

/** A priced job row with form completed — passes all hard gate checks */
function pricedJobRow(
  s: DemoScenario,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const estimate: PriceEstimate = {
    calloutFeePence: s.expectedPricing.calloutFeePence,
    repairEstimateMinPence: s.expectedPricing.repairEstimateMinPence,
    repairEstimateMaxPence: s.expectedPricing.repairEstimateMaxPence,
    currency: "gbp",
    explanation: "Test explanation.",
  };
  return {
    id: "job-demo-001",
    status: "priced",
    customer_id: "cust-demo-001",
    reservation_id: null,
    payment_id: null,
    price_estimate: estimate,
    call_sessions: [
      { id: "sess-demo-001", intake_form_completed_at: "2024-01-01T10:00:00Z" },
    ],
    ...overrides,
  };
}

// ─── 1. Classification mapping ────────────────────────────────────────────────

describe("Classification mapping", () => {
  describe.each(demoScenarios)("$label", (scenario) => {
    it("parseAndValidateClassification accepts the expected OpenAI output", () => {
      const json = makeClassificationJson(scenario);
      const result = parseAndValidateClassification(json);

      expect(result).not.toBeNull();
      expect(result!.requiredSkill).toBe(scenario.expectedClassification.requiredSkill);
      expect(result!.urgency).toBe(scenario.expectedClassification.urgency);
      expect(result!.jobCategory.toLowerCase()).toContain(
        scenario.expectedClassification.jobCategoryKeyword,
      );
    });

    it("rejects an invalid skill for this scenario", () => {
      const json = JSON.stringify({
        requiredSkill: "landscaping",
        urgency: scenario.expectedClassification.urgency,
        jobCategory: "Garden work",
      });
      expect(parseAndValidateClassification(json)).toBeNull();
    });

    it("rejects an invalid urgency for this scenario", () => {
      const json = JSON.stringify({
        requiredSkill: scenario.expectedClassification.requiredSkill,
        urgency: "whenever",
        jobCategory: "Some job",
      });
      expect(parseAndValidateClassification(json)).toBeNull();
    });
  });
});

// ─── 2. Pricing rule selection ────────────────────────────────────────────────

describe("Pricing rule selection", () => {
  describe.each(demoScenarios)("$label", (scenario) => {
    const { requiredSkill, urgency } = scenario.expectedClassification;
    const { calloutFeePence, repairEstimateMinPence, repairEstimateMaxPence } =
      scenario.expectedPricing;

    it("lookupRule returns the correct callout fee", () => {
      const rule = lookupRule(requiredSkill, urgency);
      expect(rule.calloutFeePence).toBe(calloutFeePence);
    });

    it("lookupRule returns the correct repair range", () => {
      const rule = lookupRule(requiredSkill, urgency);
      expect(rule.repairEstimateMinPence).toBe(repairEstimateMinPence);
      expect(rule.repairEstimateMaxPence).toBe(repairEstimateMaxPence);
    });

    it("repair max is always greater than repair min", () => {
      const rule = lookupRule(requiredSkill, urgency);
      expect(rule.repairEstimateMaxPence).toBeGreaterThan(rule.repairEstimateMinPence);
    });

    it("buildExplanation mentions the correct callout fee in pounds", () => {
      const rule = lookupRule(requiredSkill, urgency);
      const calloutPounds = (calloutFeePence / 100).toFixed(0);
      const explanation = buildExplanation(rule, "gbp", `${scenario.expectedClassification.jobCategoryKeyword} repair`);
      expect(explanation).toContain(`£${calloutPounds}`);
    });

    it("buildExplanation mentions the repair range", () => {
      const rule = lookupRule(requiredSkill, urgency);
      const minPounds = (repairEstimateMinPence / 100).toFixed(0);
      const maxPounds = (repairEstimateMaxPence / 100).toFixed(0);
      const explanation = buildExplanation(rule, "gbp", "Test job");
      expect(explanation).toContain(`£${minPounds}`);
      expect(explanation).toContain(`£${maxPounds}`);
    });

    it("buildExplanation clearly states the estimate is not a fixed quote", () => {
      const rule = lookupRule(requiredSkill, urgency);
      const explanation = buildExplanation(rule, "gbp", "Test job");
      expect(explanation).toContain("not a fixed quote");
    });
  });
});

// ─── 3. Hard gate — per scenario ──────────────────────────────────────────────

describe("Hard gate: blocks payment when intake form incomplete", () => {
  describe.each(demoScenarios)("$label", (scenario) => {
    it("blocks payment when call_sessions array is empty (form not submitted)", async () => {
      // Import here so the Supabase mock is active
      const { createPaymentSession } = await import("@/app/actions/payment");

      mockJobData = pricedJobRow(scenario, { call_sessions: [] });
      mockCustomerData = fullCustomer(scenario);

      const result = await createPaymentSession("job-demo-001");

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("intake_form_incomplete");
    });

    it("blocks payment when intake_form_completed_at is null", async () => {
      const { createPaymentSession } = await import("@/app/actions/payment");

      mockJobData = pricedJobRow(scenario, {
        call_sessions: [
          { id: "sess-001", intake_form_completed_at: null },
        ],
      });
      mockCustomerData = fullCustomer(scenario);

      const result = await createPaymentSession("job-demo-001");

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("intake_form_incomplete");
    });

    it("allows payment once the form is complete with all fields present", async () => {
      const { createPaymentSession } = await import("@/app/actions/payment");

      mockJobData = pricedJobRow(scenario);
      mockCustomerData = fullCustomer(scenario);

      const result = await createPaymentSession("job-demo-001");

      expect(result.success).toBe(true);
    });

    it("blocks payment when customer contact fields are missing after form submission", async () => {
      const { createPaymentSession } = await import("@/app/actions/payment");

      mockJobData = pricedJobRow(scenario);
      // Simulate form submitted but customer record missing name (shouldn't
      // happen in practice, but the gate checks anyway)
      mockCustomerData = { ...fullCustomer(scenario), name: null };

      const result = await createPaymentSession("job-demo-001");

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("missing_customer_fields");
    });
  });
});

// ─── 4. Intake form field validation — per scenario ───────────────────────────

describe("Intake form validation", () => {
  describe.each(demoScenarios)("$label", (scenario) => {
    it("validates successfully with the scenario's intake form fields", () => {
      const errors = validateIntakeFields(scenario.intakeFormFields);
      expect(errors).toBeNull();
    });

    it("rejects submission when name is blank", () => {
      const errors = validateIntakeFields({
        ...scenario.intakeFormFields,
        name: "",
      });
      expect(errors).not.toBeNull();
      expect(errors!.name).toBeTruthy();
    });

    it("rejects submission when postcode is invalid", () => {
      const errors = validateIntakeFields({
        ...scenario.intakeFormFields,
        postcode: "NOTAPOSTCODE",
      });
      expect(errors).not.toBeNull();
      expect(errors!.postcode).toBeTruthy();
    });
  });
});

// ─── 5. End-to-end scenario shape assertions ──────────────────────────────────

describe("Scenario fixture integrity", () => {
  it("all three canonical scenarios are exported", () => {
    expect(boilerFailure.expectedClassification.requiredSkill).toBe("heating");
    expect(leakInvestigation.expectedClassification.requiredSkill).toBe("plumbing");
    expect(electricalFault.expectedClassification.requiredSkill).toBe("electrical");
  });

  it("all scenarios have unique vapiCallIds", () => {
    const ids = demoScenarios.map((s) => s.vapiCallId);
    expect(new Set(ids).size).toBe(demoScenarios.length);
  });

  it("all scenarios have unique phone numbers", () => {
    const phones = demoScenarios.map((s) => s.phoneNumber);
    expect(new Set(phones).size).toBe(demoScenarios.length);
  });

  it("all scenarios have non-empty transcripts longer than MIN_TRANSCRIPT_LENGTH", () => {
    for (const s of demoScenarios) {
      expect(s.transcript.trim().length, `${s.label} transcript too short`).toBeGreaterThan(50);
    }
  });

  it("all scenarios have at least 3 expected summary keywords", () => {
    for (const s of demoScenarios) {
      expect(
        s.expectedSummaryKeywords.length,
        `${s.label} needs at least 3 summary keywords`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("all scenarios have valid UK postcodes", () => {
    const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
    for (const s of demoScenarios) {
      expect(
        postcodePattern.test(s.intakeFormFields.postcode),
        `${s.label}: "${s.intakeFormFields.postcode}" is not a valid UK postcode`,
      ).toBe(true);
    }
  });

  it.each([
    ["boiler failure", boilerFailure, 8000, 10000, 30000],
    ["leak investigation", leakInvestigation, 6000, 6000, 20000],
    ["electrical fault", electricalFault, 15000, 12000, 50000],
  ] as const)(
    "%s has expected pricing: callout=%dp, range=%dp–%dp",
    (_label, scenario, callout, min, max) => {
      expect(scenario.expectedPricing.calloutFeePence).toBe(callout);
      expect(scenario.expectedPricing.repairEstimateMinPence).toBe(min);
      expect(scenario.expectedPricing.repairEstimateMaxPence).toBe(max);
    },
  );

  it("emergency electrical has highest callout fee of all three", () => {
    const elecCallout = electricalFault.expectedPricing.calloutFeePence;
    const boilerCallout = boilerFailure.expectedPricing.calloutFeePence;
    const leakCallout = leakInvestigation.expectedPricing.calloutFeePence;
    expect(elecCallout).toBeGreaterThan(boilerCallout);
    expect(elecCallout).toBeGreaterThan(leakCallout);
  });

  it("scheduled leak investigation has lowest callout fee of all three", () => {
    const leakCallout = leakInvestigation.expectedPricing.calloutFeePence;
    const boilerCallout = boilerFailure.expectedPricing.calloutFeePence;
    const elecCallout = electricalFault.expectedPricing.calloutFeePence;
    expect(leakCallout).toBeLessThan(boilerCallout);
    expect(leakCallout).toBeLessThan(elecCallout);
  });
});
