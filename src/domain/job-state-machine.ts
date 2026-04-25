import type { Job, JobStatus } from "./types";

type TransitionResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
    };

const allowedTransitions: Record<JobStatus, JobStatus[]> = {
  intake: ["qualified"],
  qualified: ["priced"],
  priced: ["slot_held"],
  slot_held: ["awaiting_payment", "expired"],
  awaiting_payment: ["confirmed", "expired"],
  confirmed: ["completed"],
  expired: [],
  completed: [],
};

const requiredFieldsByStatus: Partial<Record<JobStatus, Array<keyof Job>>> = {
  qualified: ["problemSummary", "urgency", "requiredSkill"],
  priced: ["problemSummary", "urgency", "requiredSkill", "priceEstimate"],
  slot_held: [
    "problemSummary",
    "urgency",
    "requiredSkill",
    "priceEstimate",
    "reservationId",
    "assignedWorkerId",
    "selectedSlotStartsAt",
    "selectedSlotEndsAt",
  ],
  awaiting_payment: [
    "problemSummary",
    "urgency",
    "requiredSkill",
    "priceEstimate",
    "reservationId",
    "assignedWorkerId",
    "selectedSlotStartsAt",
    "selectedSlotEndsAt",
  ],
  confirmed: [
    "problemSummary",
    "urgency",
    "requiredSkill",
    "priceEstimate",
    "reservationId",
    "assignedWorkerId",
    "paymentId",
    "selectedSlotStartsAt",
    "selectedSlotEndsAt",
  ],
};

export function getMissingFieldsForStatus(
  job: Job,
  targetStatus: JobStatus,
): string[] {
  const requiredFields = requiredFieldsByStatus[targetStatus] ?? [];

  return requiredFields.filter((fieldName) => {
    const value = job[fieldName];
    return value === null || value === undefined || value === "";
  });
}

export function canTransitionJob(
  job: Job,
  targetStatus: JobStatus,
): TransitionResult {
  if (!allowedTransitions[job.status].includes(targetStatus)) {
    return {
      allowed: false,
      reason: `Cannot transition job from ${job.status} to ${targetStatus}`,
    };
  }

  const missingFields = getMissingFieldsForStatus(job, targetStatus);
  if (missingFields.length > 0) {
    return {
      allowed: false,
      reason: `Missing required fields for ${targetStatus}: ${missingFields.join(", ")}`,
    };
  }

  return { allowed: true };
}

export function transitionJobStatus(job: Job, targetStatus: JobStatus): Job {
  const transition = canTransitionJob(job, targetStatus);

  if (!transition.allowed) {
    throw new Error(transition.reason);
  }

  return {
    ...job,
    status: targetStatus,
    updatedAt: new Date().toISOString(),
  };
}
