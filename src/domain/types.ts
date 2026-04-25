import type {
  jobStatuses,
  paymentStatuses,
  reservationStatuses,
  uploadedAssetTypes,
  urgencyLevels,
  workerSkills,
} from "./enums";

export type JobStatus = (typeof jobStatuses)[number];
export type Urgency = (typeof urgencyLevels)[number];
export type WorkerSkill = (typeof workerSkills)[number];
export type PaymentStatus = (typeof paymentStatuses)[number];
export type ReservationStatus = (typeof reservationStatuses)[number];
export type UploadedAssetType = (typeof uploadedAssetTypes)[number];

export type EntityId = string;

export type ServiceBusiness = {
  id: EntityId;
  name: string;
  phoneNumber: string;
  serviceArea: string;
  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id: EntityId;
  serviceBusinessId: EntityId;
  name: string | null;
  phoneNumber: string;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CallSession = {
  id: EntityId;
  serviceBusinessId: EntityId;
  customerId: EntityId | null;
  jobId: EntityId | null;
  providerSessionId: string | null;
  transcript: string | null;
  eventHistory: Record<string, unknown>[];
  summary: string | null;
  extractionStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type PriceEstimate = {
  calloutFeePence: number;
  repairEstimateMinPence: number;
  repairEstimateMaxPence: number;
  currency: string;
  explanation: string;
};

export type Job = {
  id: EntityId;
  serviceBusinessId?: EntityId;
  customerId: EntityId;
  status: JobStatus;
  problemSummary: string | null;
  urgency: Urgency | null;
  requiredSkill: WorkerSkill | null;
  assignedWorkerId?: EntityId | null;
  reservationId?: EntityId | null;
  paymentId?: EntityId | null;
  selectedSlotStartsAt?: string | null;
  selectedSlotEndsAt?: string | null;
  priceEstimate?: PriceEstimate | null;
  createdAt: string;
  updatedAt: string;
};

export type Worker = {
  id: EntityId;
  serviceBusinessId: EntityId;
  name: string;
  skill: WorkerSkill;
  serviceArea: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AvailabilityWindow = {
  id: EntityId;
  workerId: EntityId;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Reservation = {
  id: EntityId;
  jobId: EntityId;
  workerId: EntityId;
  status: ReservationStatus;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Payment = {
  id: EntityId;
  jobId: EntityId;
  reservationId: EntityId | null;
  status: PaymentStatus;
  amountPence: number;
  currency: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadedAsset = {
  id: EntityId;
  jobId: EntityId | null;
  callSessionId: EntityId | null;
  type: UploadedAssetType;
  storagePath: string;
  analysisStatus: string | null;
  analysisResult: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
