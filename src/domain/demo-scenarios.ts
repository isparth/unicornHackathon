/**
 * Demo Scenarios — Mid-Call Intake Form Submission Fixtures
 *
 * These fixtures simulate a complete mid-call form submission flow for three
 * representative job types:
 *   1. Boiler failure     (heating  / same_day)
 *   2. Leak investigation (plumbing / scheduled)
 *   3. Electrical fault   (electrical / emergency)
 *
 * Each scenario contains:
 *   - The Vapi call identifier the voice agent would send
 *   - The call transcript from which the Call Summary Service generates a summary
 *   - The intake form fields the customer fills in mid-call
 *   - The expected classification outputs (skill, urgency, category)
 *   - The expected pricing outputs (callout fee, repair range)
 *   - A customer-ready price explanation excerpt for assertion
 *
 * These are used in acceptance tests and can be fed directly into the route
 * handlers in a local demo run.
 */

import type { IntakeFormFields } from "@/app/actions/intake-types";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type DemoScenario = {
  /** Human-readable label for test reporting */
  label: string;

  /** Simulated Vapi call ID */
  vapiCallId: string;

  /** The service business that receives the call */
  serviceBusinessId: string;

  /** Caller's E.164 phone number */
  phoneNumber: string;

  /**
   * Realistic call transcript — what the customer actually said to the agent.
   * Used by the Call Summary Service to generate problem_summary.
   */
  transcript: string;

  /**
   * Expected problem_summary content.
   * Assertions check that the real summary contains these keywords.
   */
  expectedSummaryKeywords: string[];

  /** The intake form data the customer fills in on their phone */
  intakeFormFields: IntakeFormFields;

  /** Expected classification */
  expectedClassification: {
    requiredSkill: "plumbing" | "heating" | "electrical";
    urgency: "emergency" | "same_day" | "scheduled";
    jobCategoryKeyword: string;
  };

  /** Expected pricing rule output (exact pence values from PRICING_RULES) */
  expectedPricing: {
    calloutFeePence: number;
    repairEstimateMinPence: number;
    repairEstimateMaxPence: number;
  };
};

// ─── Scenario 1: Boiler Failure ───────────────────────────────────────────────

const boilerFailure: DemoScenario = {
  label: "Boiler failure — heating / same_day",
  vapiCallId: "vapi-call-boiler-001",
  serviceBusinessId: "00000000-0000-4000-8000-000000000001",
  phoneNumber: "+447700900111",

  transcript: `
Agent: Hi, you've reached Northstar Home Services. How can I help you today?
Customer: Hi yes, my boiler has stopped working. It's showing an error code — it says E2 on the display.
Agent: I'm sorry to hear that. How long has it been showing that error?
Customer: Since this morning, about 6am. We've had no hot water all day and it's freezing.
Agent: Is there any risk to safety that you're aware of — any gas smell or unusual sounds?
Customer: No gas smell, but there's a low humming. It's a Worcester Bosch, about six years old.
Agent: OK, and how urgently do you need this looked at?
Customer: Today if possible — I have two young kids and we need hot water.
Agent: Understood. I'm going to send you a short form by text now so we can get your details.
  `.trim(),

  expectedSummaryKeywords: ["boiler", "error", "hot water"],

  intakeFormFields: {
    name: "Sarah Connor",
    addressLine1: "42 Elm Street",
    city: "Islington",
    postcode: "N1 2BT",
    phoneNumber: "+447700900111",
  },

  expectedClassification: {
    requiredSkill: "heating",
    urgency: "same_day",
    jobCategoryKeyword: "boiler",
  },

  // heating × same_day from PRICING_RULES
  expectedPricing: {
    calloutFeePence: 8000,
    repairEstimateMinPence: 10000,
    repairEstimateMaxPence: 30000,
  },
};

// ─── Scenario 2: Leak Investigation ──────────────────────────────────────────

const leakInvestigation: DemoScenario = {
  label: "Leak investigation — plumbing / scheduled",
  vapiCallId: "vapi-call-leak-002",
  serviceBusinessId: "00000000-0000-4000-8000-000000000001",
  phoneNumber: "+447700900222",

  transcript: `
Agent: Hi, you've reached Northstar Home Services. How can I help you today?
Customer: Hello, I've noticed water under my kitchen sink. It seems to be leaking from the pipe connections.
Agent: Is it a steady drip or is water pouring out?
Customer: It's a slow drip, has been going on for a couple of days. It's manageable — I've put a towel under it.
Agent: Any sign of damage to the cabinet or floor?
Customer: The cabinet floor is a bit damp but nothing major. It started after I had the washing machine running.
Agent: Does this need to be seen today or would a scheduled visit work?
Customer: Scheduled is fine, maybe in the next day or two.
Agent: Perfect. Let me send you a short form by text to get your details.
  `.trim(),

  expectedSummaryKeywords: ["leak", "kitchen", "sink"],

  intakeFormFields: {
    name: "David Okafor",
    addressLine1: "15 Rosemary Lane",
    city: "Hackney",
    postcode: "E8 3QP",
    phoneNumber: "+447700900222",
  },

  expectedClassification: {
    requiredSkill: "plumbing",
    urgency: "scheduled",
    jobCategoryKeyword: "leak",
  },

  // plumbing × scheduled from PRICING_RULES
  expectedPricing: {
    calloutFeePence: 6000,
    repairEstimateMinPence: 6000,
    repairEstimateMaxPence: 20000,
  },
};

// ─── Scenario 3: Electrical Fault ─────────────────────────────────────────────

const electricalFault: DemoScenario = {
  label: "Electrical fault — electrical / emergency",
  vapiCallId: "vapi-call-elec-003",
  serviceBusinessId: "00000000-0000-4000-8000-000000000001",
  phoneNumber: "+447700900333",

  transcript: `
Agent: Hi, you've reached Northstar Home Services. How can I help?
Customer: Hi, I've got a serious problem. Every time I switch on the kettle downstairs, all the sockets trip and go dead.
Agent: Is the fuse box tripping, or is it just those sockets losing power?
Customer: The whole downstairs ring main trips on the fuse box. I've reset it three times today and it keeps tripping.
Agent: Is there any burning smell, sparking, or visible scorch marks?
Customer: There's a slight burning smell near one of the sockets. I'm keeping clear of it.
Agent: That's a safety concern — you're right to keep clear. Can I ask, is this urgent?
Customer: Yes, very urgent. I can't use the kitchen at all and I'm worried about a fire risk.
Agent: Absolutely understood. I'm classifying this as an emergency. Let me send you a form now.
  `.trim(),

  expectedSummaryKeywords: ["socket", "trip", "fuse"],

  intakeFormFields: {
    name: "Marcus Webb",
    addressLine1: "8 Victoria Terrace",
    city: "Barnet",
    postcode: "EN5 1DJ",
    phoneNumber: "+447700900333",
  },

  expectedClassification: {
    requiredSkill: "electrical",
    urgency: "emergency",
    jobCategoryKeyword: "electrical",
  },

  // electrical × emergency from PRICING_RULES
  expectedPricing: {
    calloutFeePence: 15000,
    repairEstimateMinPence: 12000,
    repairEstimateMaxPence: 50000,
  },
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const demoScenarios: DemoScenario[] = [
  boilerFailure,
  leakInvestigation,
  electricalFault,
];

export { boilerFailure, leakInvestigation, electricalFault };
