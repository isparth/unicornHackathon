/**
 * Shared types, constants, and pure validation helpers for the intake form.
 *
 * This file has NO "use server" directive so it can be imported freely by
 * both client components and server actions.
 */

export type IntakeFormFields = {
  name: string;
  addressLine1: string;
  city: string;
  postcode: string;
  phoneNumber: string;
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

  return Object.keys(errors).length > 0 ? errors : null;
}
