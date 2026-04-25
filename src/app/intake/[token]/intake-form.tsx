"use client";

import { useState, useTransition } from "react";
import {
  submitIntakeForm,
  validateIntakeFields,
  type IntakeFormFields,
  type SubmitIntakeFormResult,
} from "@/app/actions/intake";

type Props = {
  token: string;
};

type FormState =
  | { stage: "idle" }
  | { stage: "submitting" }
  | { stage: "success" }
  | { stage: "error"; result: Extract<SubmitIntakeFormResult, { success: false }> };

const emptyFields: IntakeFormFields = {
  name: "",
  addressLine1: "",
  city: "",
  postcode: "",
  phoneNumber: "",
  problemDescription: "",
  additionalDetails: "",
};

export function IntakeForm({ token }: Props) {
  const [fields, setFields] = useState<IntakeFormFields>(emptyFields);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formState, setFormState] = useState<FormState>({ stage: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors = validateIntakeFields(fields);
    if (errors) {
      setFieldErrors(errors);
      // Scroll to the first error
      const firstKey = Object.keys(errors)[0];
      document.getElementById(firstKey)?.focus();
      return;
    }

    setFieldErrors({});
    setFormState({ stage: "submitting" });

    startTransition(async () => {
      const result = await submitIntakeForm(token, fields);
      if (result.success) {
        setFormState({ stage: "success" });
      } else {
        setFormState({ stage: "error", result });
      }
    });
  }

  if (formState.stage === "success") {
    return <SuccessState />;
  }

  const isSubmitting = formState.stage === "submitting" || isPending;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
          Quick form
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">
          Your details
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Takes under a minute. Fill this in while you're on the call.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-5">
        {/* Server-level error banner */}
        {formState.stage === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formState.result.message}
          </div>
        )}

        {/* Name */}
        <Field
          id="name"
          label="Your name"
          error={fieldErrors.name}
        >
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            value={fields.name}
            onChange={handleChange}
            placeholder="e.g. Sarah Jones"
            className={inputClass(!!fieldErrors.name)}
          />
        </Field>

        {/* Address */}
        <Field
          id="addressLine1"
          label="Address"
          error={fieldErrors.addressLine1}
        >
          <input
            id="addressLine1"
            name="addressLine1"
            type="text"
            autoComplete="address-line1"
            autoCapitalize="words"
            value={fields.addressLine1}
            onChange={handleChange}
            placeholder="e.g. 14 Oak Street"
            className={inputClass(!!fieldErrors.addressLine1)}
          />
        </Field>

        {/* City + Postcode side by side */}
        <div className="grid grid-cols-2 gap-3">
          <Field id="city" label="City" error={fieldErrors.city}>
            <input
              id="city"
              name="city"
              type="text"
              autoComplete="address-level2"
              autoCapitalize="words"
              value={fields.city}
              onChange={handleChange}
              placeholder="London"
              className={inputClass(!!fieldErrors.city)}
            />
          </Field>
          <Field id="postcode" label="Postcode" error={fieldErrors.postcode}>
            <input
              id="postcode"
              name="postcode"
              type="text"
              autoComplete="postal-code"
              autoCapitalize="characters"
              value={fields.postcode}
              onChange={handleChange}
              placeholder="N1 2AB"
              className={inputClass(!!fieldErrors.postcode)}
            />
          </Field>
        </div>

        {/* Phone */}
        <Field
          id="phoneNumber"
          label="Phone number"
          hint="Confirm the number we can reach you on"
          error={fieldErrors.phoneNumber}
        >
          <input
            id="phoneNumber"
            name="phoneNumber"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={fields.phoneNumber}
            onChange={handleChange}
            placeholder="+44 7700 900123"
            className={inputClass(!!fieldErrors.phoneNumber)}
          />
        </Field>

        {/* Problem description */}
        <Field
          id="problemDescription"
          label="What's the problem?"
          error={fieldErrors.problemDescription}
        >
          <textarea
            id="problemDescription"
            name="problemDescription"
            rows={3}
            value={fields.problemDescription}
            onChange={handleChange}
            placeholder="e.g. Boiler showing error E2, no hot water since this morning"
            className={`${inputClass(!!fieldErrors.problemDescription)} resize-none`}
          />
        </Field>

        {/* Additional details (optional) */}
        <Field
          id="additionalDetails"
          label="Anything else we should know?"
          hint="Optional"
          error={fieldErrors.additionalDetails}
        >
          <textarea
            id="additionalDetails"
            name="additionalDetails"
            rows={2}
            value={fields.additionalDetails}
            onChange={handleChange}
            placeholder="e.g. The boiler is in a cupboard on the first floor"
            className={`${inputClass(false)} resize-none`}
          />
        </Field>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-blue-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Sending…" : "Send details"}
        </button>

        <p className="text-center text-xs text-gray-400">
          Your details are stored securely and used only for this booking.
        </p>
      </form>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function inputClass(hasError: boolean) {
  return [
    "w-full rounded-xl border px-4 py-3 text-base text-gray-900 placeholder-gray-400",
    "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
    "disabled:opacity-50",
    hasError
      ? "border-red-400 bg-red-50"
      : "border-gray-300 bg-white",
  ].join(" ");
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-semibold text-gray-800">
          {label}
        </label>
        {hint && !error && (
          <span className="text-xs text-gray-400">{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="text-xs font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}

function SuccessState() {
  return (
    <div className="rounded-2xl border border-green-200 bg-white px-6 py-8 shadow-sm">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <svg
          className="h-6 w-6 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900">Details received</h2>
      <p className="mt-2 text-sm text-gray-600">
        Thanks! We have everything we need. The agent will continue with your
        booking shortly — you can stay on the call.
      </p>
    </div>
  );
}
