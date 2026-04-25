"use server";

/**
 * Intake Form Submission Action
 *
 * Validates the signed token, writes verified customer details to the DB,
 * advances the job to "qualified", and marks the call session as complete.
 *
 * Idempotent: submitting the same token a second time updates the existing
 * records rather than creating duplicates.
 */

import { appConfig } from "@/config/app-config";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import { markIntakeFormComplete } from "@/server/services/call-session-service";
import { verifyIntakeToken } from "@/server/services/intake-token-service";

export type IntakeFormFields = {
  name: string;
  addressLine1: string;
  city: string;
  postcode: string;
  phoneNumber: string;
  problemDescription: string;
  additionalDetails: string;
};

/** Client-side photo attachment — base64 data URL + metadata */
export type PhotoAttachment = {
  /** data URL — e.g. "data:image/jpeg;base64,..." */
  dataUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export const PHOTO_LIMITS = {
  maxCount: 5,
  maxTotalBytes: 10 * 1024 * 1024, // 10 MB
  maxSingleBytes: 5 * 1024 * 1024,  // 5 MB per file
  acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
} as const;

export type SubmitIntakeFormResult =
  | { success: true }
  | { success: false; error: "token_invalid" | "token_expired" | "photo_limit" | "server_error"; message: string };

/**
 * Validate form fields and return a map of field-level error messages.
 * Returns null when all fields are valid.
 */
export function validateIntakeFields(
  fields: IntakeFormFields,
): Record<string, string> | null {
  const errors: Record<string, string> = {};

  if (!fields.name.trim()) errors.name = "Name is required.";
  if (!fields.addressLine1.trim())
    errors.addressLine1 = "Address is required.";
  if (!fields.city.trim()) errors.city = "City is required.";

  const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
  if (!fields.postcode.trim()) {
    errors.postcode = "Postcode is required.";
  } else if (!postcodePattern.test(fields.postcode.trim())) {
    errors.postcode = "Enter a valid UK postcode.";
  }

  const phonePattern = /^\+?[\d\s\-().]{7,20}$/;
  if (!fields.phoneNumber.trim()) {
    errors.phoneNumber = "Phone number is required.";
  } else if (!phonePattern.test(fields.phoneNumber.trim())) {
    errors.phoneNumber = "Enter a valid phone number.";
  }

  if (!fields.problemDescription.trim())
    errors.problemDescription = "Please describe the problem.";

  return Object.keys(errors).length > 0 ? errors : null;
}

export async function submitIntakeForm(
  token: string,
  fields: IntakeFormFields,
  photos: PhotoAttachment[] = [],
): Promise<SubmitIntakeFormResult> {
  // 1a. Server-side photo limit enforcement (defence-in-depth over client checks)
  if (photos.length > PHOTO_LIMITS.maxCount) {
    return {
      success: false,
      error: "photo_limit",
      message: `You can attach a maximum of ${PHOTO_LIMITS.maxCount} photos.`,
    };
  }
  const totalBytes = photos.reduce((sum, p) => sum + p.sizeBytes, 0);
  if (totalBytes > PHOTO_LIMITS.maxTotalBytes) {
    return {
      success: false,
      error: "photo_limit",
      message: "Total photo size exceeds the 10 MB limit. Please remove some photos.",
    };
  }
  for (const photo of photos) {
    if (!PHOTO_LIMITS.acceptedMimeTypes.includes(photo.mimeType as typeof PHOTO_LIMITS.acceptedMimeTypes[number])) {
      return {
        success: false,
        error: "photo_limit",
        message: `File "${photo.fileName}" is not a supported image type.`,
      };
    }
    if (photo.sizeBytes > PHOTO_LIMITS.maxSingleBytes) {
      return {
        success: false,
        error: "photo_limit",
        message: `File "${photo.fileName}" exceeds the 5 MB per-photo limit.`,
      };
    }
  }

  // 1b. Verify the token
  const result = verifyIntakeToken(token, appConfig.intakeToken.secret);
  if (!result.valid) {
    return {
      success: false,
      error: result.reason === "expired" ? "token_expired" : "token_invalid",
      message:
        result.reason === "expired"
          ? "This form link has expired. Please ask the agent to resend it."
          : "This form link is not valid. Please ask the agent to resend it.",
    };
  }

  const { sessionId } = result.payload;
  const supabase = createSupabaseServiceClient();

  // 2. Load the call session to get the linked job and customer
  const { data: session, error: sessionError } = await supabase
    .from("call_sessions")
    .select("id, customer_id, job_id, service_business_id, intake_form_completed_at")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return {
      success: false,
      error: "server_error",
      message: "Could not load your session. Please try again.",
    };
  }

  const serviceBusinessId = session.service_business_id as string;
  const existingCustomerId = session.customer_id as string | null;
  const jobId = session.job_id as string | null;

  // 3. Upsert the customer record (idempotent)
  let customerId: string;

  if (existingCustomerId) {
    // Update existing customer record with verified form data
    const { error: updateError } = await supabase
      .from("customers")
      .update({
        name: fields.name.trim(),
        phone_number: fields.phoneNumber.trim(),
        address_line_1: fields.addressLine1.trim(),
        city: fields.city.trim(),
        postcode: fields.postcode.trim().toUpperCase(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingCustomerId);

    if (updateError) {
      return {
        success: false,
        error: "server_error",
        message: "Could not save your details. Please try again.",
      };
    }

    customerId = existingCustomerId;
  } else {
    // Create a new customer record
    const { data: newCustomer, error: insertError } = await supabase
      .from("customers")
      .insert({
        service_business_id: serviceBusinessId,
        name: fields.name.trim(),
        phone_number: fields.phoneNumber.trim(),
        address_line_1: fields.addressLine1.trim(),
        city: fields.city.trim(),
        postcode: fields.postcode.trim().toUpperCase(),
      })
      .select("id")
      .single();

    if (insertError || !newCustomer) {
      return {
        success: false,
        error: "server_error",
        message: "Could not save your details. Please try again.",
      };
    }

    customerId = (newCustomer as { id: string }).id;

    // Link customer back to the call session
    await supabase
      .from("call_sessions")
      .update({ customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  // 4. Upsert the job record with problem description (idempotent)
  if (jobId) {
    // Update existing job: write problem summary and advance to qualified
    // We only advance if currently in "intake" — later states are left alone.
    const { data: currentJob } = await supabase
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    const updates: Record<string, unknown> = {
      problem_summary: fields.problemDescription.trim(),
      updated_at: new Date().toISOString(),
    };

    // Advance to qualified only from intake — the state machine allows intake -> qualified
    if (currentJob && (currentJob as { status: string }).status === "intake") {
      updates.status = "qualified";
    }

    const { error: jobUpdateError } = await supabase
      .from("jobs")
      .update(updates)
      .eq("id", jobId);

    if (jobUpdateError) {
      return {
        success: false,
        error: "server_error",
        message: "Could not update your job record. Please try again.",
      };
    }
  } else {
    // No job yet — create one in "qualified" state (all required fields are present)
    const { data: newJob, error: jobInsertError } = await supabase
      .from("jobs")
      .insert({
        service_business_id: serviceBusinessId,
        customer_id: customerId,
        status: "qualified",
        problem_summary: fields.problemDescription.trim(),
      })
      .select("id")
      .single();

    if (jobInsertError || !newJob) {
      return {
        success: false,
        error: "server_error",
        message: "Could not create your job record. Please try again.",
      };
    }

    const newJobId = (newJob as { id: string }).id;

    // Link the new job back to the call session
    await supabase
      .from("call_sessions")
      .update({
        job_id: newJobId,
        customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  // 5. Store photo metadata as uploaded_asset records (best-effort — don't block on failure)
  if (photos.length > 0) {
    const resolvedJobId = jobId ?? (session.job_id as string | null);
    for (const photo of photos) {
      // Store the base64 data URL as the storage_path for now.
      // In Milestone 5 this will be replaced with a real Supabase Storage upload.
      await supabase.from("uploaded_assets").insert({
        job_id: resolvedJobId,
        call_session_id: sessionId,
        type: "image",
        storage_path: photo.dataUrl,
        analysis_status: "pending",
      });
    }
  }

  // 6. Mark the intake form as complete on the call session
  // (skipped if it was already marked — idempotent)
  if (!session.intake_form_completed_at) {
    await markIntakeFormComplete(sessionId);
  }

  return { success: true };
}
