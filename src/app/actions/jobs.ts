"use server";

import { demoJobs } from "@/domain/demo-data";
import { canTransitionJob } from "@/domain/job-state-machine";
import type { JobStatus } from "@/domain/types";

export async function validateDemoJobTransition(
  jobId: string,
  targetStatus: JobStatus,
) {
  const job = demoJobs.find((candidate) => candidate.id === jobId);

  if (!job) {
    return {
      allowed: false,
      reason: `Job ${jobId} was not found in demo data`,
    };
  }

  return canTransitionJob(job, targetStatus);
}
