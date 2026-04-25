export const jobStatuses = [
  "intake",
  "qualified",
  "priced",
  "slot_held",
  "awaiting_payment",
  "confirmed",
  "expired",
  "completed",
] as const;

export const paymentStatuses = [
  "pending",
  "paid",
  "failed",
  "refunded",
] as const;

export const urgencyLevels = ["emergency", "same_day", "scheduled"] as const;

export const reservationStatuses = [
  "held",
  "released",
  "expired",
  "confirmed",
] as const;

export const workerSkills = ["plumbing", "heating", "electrical"] as const;

export const uploadedAssetTypes = ["image", "transcript", "document"] as const;

export const imageAnalysisStatuses = [
  "pending",
  "processing",
  "done",
  "failed",
] as const;

export const outboundMessageTypes = [
  "intake_form_link",
  "image_upload_link",
  "payment_link",
  "booking_confirmation",
] as const;
