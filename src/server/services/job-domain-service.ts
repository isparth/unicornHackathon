import {
  canTransitionJob,
  transitionJobStatus,
} from "@/domain/job-state-machine";
import type { Job, JobStatus } from "@/domain/types";

export function previewJobTransition(job: Job, targetStatus: JobStatus) {
  return canTransitionJob(job, targetStatus);
}

export function applyJobTransition(job: Job, targetStatus: JobStatus): Job {
  return transitionJobStatus(job, targetStatus);
}
