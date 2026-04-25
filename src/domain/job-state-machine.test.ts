import { describe, expect, it } from "vitest";

import {
  canTransitionJob,
  getMissingFieldsForStatus,
  transitionJobStatus,
} from "@/domain/job-state-machine";
import type { Job } from "@/domain/types";

const baseJob: Job = {
  id: "job_001",
  customerId: "customer_001",
  status: "intake",
  problemSummary: "Boiler is not heating water",
  urgency: "same_day",
  requiredSkill: "heating",
  createdAt: "2026-04-25T09:00:00.000Z",
  updatedAt: "2026-04-25T09:00:00.000Z",
};

describe("job state machine", () => {
  it("allows a complete intake job to become qualified", () => {
    expect(canTransitionJob(baseJob, "qualified").allowed).toBe(true);
  });

  it("blocks qualification when structured intake fields are missing", () => {
    const incompleteJob: Job = {
      ...baseJob,
      problemSummary: null,
      urgency: null,
      requiredSkill: null,
    };

    expect(canTransitionJob(incompleteJob, "qualified")).toEqual({
      allowed: false,
      reason:
        "Missing required fields for qualified: problemSummary, urgency, requiredSkill",
    });
    expect(getMissingFieldsForStatus(incompleteJob, "qualified")).toEqual([
      "problemSummary",
      "urgency",
      "requiredSkill",
    ]);
  });

  it("requires pricing data before moving from qualified to priced", () => {
    const qualifiedJob: Job = {
      ...baseJob,
      status: "qualified",
    };

    expect(canTransitionJob(qualifiedJob, "priced").allowed).toBe(false);
    expect(
      canTransitionJob(
        {
          ...qualifiedJob,
          priceEstimate: {
            calloutFeePence: 8000,
            repairEstimateMinPence: 10000,
            repairEstimateMaxPence: 25000,
            currency: "gbp",
            explanation: "Call-out plus estimated repair range.",
          },
        },
        "priced",
      ).allowed,
    ).toBe(true);
  });

  it("rejects unsupported state jumps", () => {
    expect(canTransitionJob(baseJob, "confirmed")).toEqual({
      allowed: false,
      reason: "Cannot transition job from intake to confirmed",
    });
  });

  it("returns a copied job with the new status after a valid transition", () => {
    const transitioned = transitionJobStatus(baseJob, "qualified");

    expect(transitioned.status).toBe("qualified");
    expect(transitioned).not.toBe(baseJob);
  });
});
