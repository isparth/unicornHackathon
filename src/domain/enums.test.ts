import { describe, expect, it } from "vitest";

import {
  imageAnalysisStatuses,
  jobStatuses,
  outboundMessageTypes,
  paymentStatuses,
  reservationStatuses,
  uploadedAssetTypes,
  urgencyLevels,
  workerSkills,
} from "@/domain/enums";

describe("domain enum mappings", () => {
  it("matches the job states required by the product workflow", () => {
    expect(jobStatuses).toEqual([
      "intake",
      "qualified",
      "priced",
      "slot_held",
      "awaiting_payment",
      "confirmed",
      "expired",
      "completed",
    ]);
  });

  it("defines database-backed enum values for milestone one entities", () => {
    expect(paymentStatuses).toEqual(["pending", "paid", "failed", "refunded"]);
    expect(urgencyLevels).toEqual(["emergency", "same_day", "scheduled"]);
    expect(reservationStatuses).toEqual([
      "held",
      "released",
      "expired",
      "confirmed",
    ]);
    expect(workerSkills).toEqual(["plumbing", "heating", "electrical"]);
    expect(uploadedAssetTypes).toEqual(["image", "transcript", "document"]);
  });

  it("defines image_analysis_status enum matching the DB type (milestone 5)", () => {
    expect(imageAnalysisStatuses).toEqual([
      "pending",
      "processing",
      "done",
      "failed",
    ]);
  });

  it("defines outbound_message_type enum matching the SMS service templates (milestone 5)", () => {
    expect(outboundMessageTypes).toEqual([
      "intake_form_link",
      "image_upload_link",
      "payment_link",
      "booking_confirmation",
    ]);
  });
});
