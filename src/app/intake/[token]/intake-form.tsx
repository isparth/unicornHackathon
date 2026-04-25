"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import { submitIntakeForm } from "@/app/actions/intake";
import {
  validateIntakeFields,
  PHOTO_LIMITS,
  type IntakeFormFields,
  type PhotoAttachment,
  type SubmitIntakeFormResult,
} from "@/app/actions/intake-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = { token: string };

type FormState =
  | { stage: "idle" }
  | { stage: "submitting" }
  | { stage: "success" }
  | { stage: "error"; result: Extract<SubmitIntakeFormResult, { success: false }> };

type PhotoPreview = PhotoAttachment & { previewUrl: string; id: string };

const emptyFields: IntakeFormFields = {
  name: "",
  addressLine1: "",
  city: "",
  postcode: "",
  phoneNumber: "",
  problemDescription: "",
  additionalDetails: "",
};

// ─── Main component ───────────────────────────────────────────────────────────

export function IntakeForm({ token }: Props) {
  const [fields, setFields] = useState<IntakeFormFields>(emptyFields);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formState, setFormState] = useState<FormState>({ stage: "idle" });
  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── field change ─────────────────────────────────────────────────────────
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
    }
  }

  // ── photo selection ───────────────────────────────────────────────────────
  const handlePhotoSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;
      setPhotoError(null);

      const incoming: PhotoPreview[] = [];
      let totalBytes = photos.reduce((s, p) => s + p.sizeBytes, 0);

      for (const file of files) {
        if (photos.length + incoming.length >= PHOTO_LIMITS.maxCount) {
          setPhotoError(`Maximum ${PHOTO_LIMITS.maxCount} photos allowed.`);
          break;
        }
        if (!PHOTO_LIMITS.acceptedMimeTypes.includes(file.type as typeof PHOTO_LIMITS.acceptedMimeTypes[number])) {
          setPhotoError(`"${file.name}" is not a supported image type.`);
          continue;
        }
        if (file.size > PHOTO_LIMITS.maxSingleBytes) {
          setPhotoError(`"${file.name}" is over the 5 MB per-photo limit.`);
          continue;
        }
        if (totalBytes + file.size > PHOTO_LIMITS.maxTotalBytes) {
          setPhotoError("Total photos exceed the 10 MB limit.");
          break;
        }
        totalBytes += file.size;
        const previewUrl = URL.createObjectURL(file);
        incoming.push({
          id: `${file.name}-${file.size}-${Date.now()}`,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUrl: previewUrl, // converted to real base64 on submit
          previewUrl,
        });
      }

      setPhotos((prev) => [...prev, ...incoming]);
      // Reset the input so the same file can be re-selected after removal
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [photos],
  );

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setPhotoError(null);
  }

  // ── submit ────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors = validateIntakeFields(fields);
    if (errors) {
      setFieldErrors(errors);
      const firstKey = Object.keys(errors)[0];
      document.getElementById(firstKey)?.focus();
      return;
    }

    setFieldErrors({});
    setFormState({ stage: "submitting" });

    startTransition(async () => {
      // Convert object-URL previews to real base64 data URLs before sending
      const attachments: PhotoAttachment[] = await Promise.all(
        photos.map(async (p) => {
          const response = await fetch(p.previewUrl);
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          return { dataUrl, fileName: p.fileName, mimeType: p.mimeType, sizeBytes: p.sizeBytes };
        }),
      );

      const result = await submitIntakeForm(token, fields, attachments);
      if (result.success) {
        setFormState({ stage: "success" });
      } else {
        setFormState({ stage: "error", result });
      }
    });
  }

  // ── success state ─────────────────────────────────────────────────────────
  if (formState.stage === "success") return <SuccessState />;

  const isSubmitting = formState.stage === "submitting" || isPending;
  const remainingPhotos = PHOTO_LIMITS.maxCount - photos.length;
  const totalPhotoMb = (photos.reduce((s, p) => s + p.sizeBytes, 0) / (1024 * 1024)).toFixed(1);

  return (
    <div
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
      className="overflow-hidden rounded-3xl shadow-2xl"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)" }}
        className="relative overflow-hidden px-6 pb-8 pt-7"
      >
        {/* decorative orb */}
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #f97316, transparent 70%)" }}
        />
        <div className="relative">
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest"
            style={{ background: "rgba(249,115,22,0.2)", color: "#fb923c" }}
          >
            Live call
          </span>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-white">
            Your booking details
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: "#94a3b8" }}>
            Fill this in while we&apos;re on the call — takes under a minute.
          </p>
        </div>
      </div>

      {/* ── Form body ──────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{ background: "#0f172a" }}
        className="px-6 pb-8 pt-6 space-y-6"
      >
        {/* Server-level error banner */}
        {formState.stage === "error" && (
          <div
            className="flex items-start gap-3 rounded-2xl px-4 py-3 text-sm"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            {formState.result.message}
          </div>
        )}

        {/* ── Section: About you ───────────────────────────── */}
        <SectionLabel>About you</SectionLabel>

        <Field id="name" label="Full name" error={fieldErrors.name}>
          <input
            id="name" name="name" type="text"
            autoComplete="name" autoCapitalize="words"
            value={fields.name} onChange={handleChange}
            placeholder="Sarah Jones"
            className={inputCls(!!fieldErrors.name)}
          />
        </Field>

        <Field id="phoneNumber" label="Phone number" hint="Confirm the number we can reach you on" error={fieldErrors.phoneNumber}>
          <input
            id="phoneNumber" name="phoneNumber" type="tel"
            autoComplete="tel" inputMode="tel"
            value={fields.phoneNumber} onChange={handleChange}
            placeholder="+44 7700 900123"
            className={inputCls(!!fieldErrors.phoneNumber)}
          />
        </Field>

        {/* ── Section: Your address ──────────────────────── */}
        <SectionLabel>Your address</SectionLabel>

        <Field id="addressLine1" label="Street address" error={fieldErrors.addressLine1}>
          <input
            id="addressLine1" name="addressLine1" type="text"
            autoComplete="address-line1" autoCapitalize="words"
            value={fields.addressLine1} onChange={handleChange}
            placeholder="14 Oak Street"
            className={inputCls(!!fieldErrors.addressLine1)}
          />
        </Field>

        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-3">
            <Field id="city" label="City" error={fieldErrors.city}>
              <input
                id="city" name="city" type="text"
                autoComplete="address-level2" autoCapitalize="words"
                value={fields.city} onChange={handleChange}
                placeholder="London"
                className={inputCls(!!fieldErrors.city)}
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field id="postcode" label="Postcode" error={fieldErrors.postcode}>
              <input
                id="postcode" name="postcode" type="text"
                autoComplete="postal-code" autoCapitalize="characters"
                value={fields.postcode} onChange={handleChange}
                placeholder="N1 2AB"
                className={inputCls(!!fieldErrors.postcode)}
              />
            </Field>
          </div>
        </div>

        {/* ── Section: The problem ──────────────────────── */}
        <SectionLabel>The problem</SectionLabel>

        <Field id="problemDescription" label="What's going on?" error={fieldErrors.problemDescription}>
          <textarea
            id="problemDescription" name="problemDescription"
            rows={3} value={fields.problemDescription}
            onChange={handleChange}
            placeholder="e.g. Boiler showing error code E2, no hot water since this morning"
            className={`${inputCls(!!fieldErrors.problemDescription)} resize-none`}
          />
        </Field>

        <Field id="additionalDetails" label="Anything else useful?" hint="Optional" error={undefined}>
          <textarea
            id="additionalDetails" name="additionalDetails"
            rows={2} value={fields.additionalDetails}
            onChange={handleChange}
            placeholder="e.g. Boiler is in the airing cupboard upstairs"
            className={`${inputCls(false)} resize-none`}
          />
        </Field>

        {/* ── Section: Photos ───────────────────────────── */}
        <SectionLabel>
          Photos&nbsp;
          <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.75rem" }}>
            optional · up to {PHOTO_LIMITS.maxCount} · 10 MB total
          </span>
        </SectionLabel>

        {/* Photo grid */}
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={p.fileName}
                  className="h-full w-full object-cover"
                />
                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full shadow-md transition-transform active:scale-90"
                  style={{ background: "rgba(15,23,42,0.85)", color: "#f8fafc" }}
                  aria-label={`Remove ${p.fileName}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Add more tile */}
            {remainingPhotos > 0 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl transition-colors"
                style={{ background: "rgba(249,115,22,0.07)", border: "1.5px dashed rgba(249,115,22,0.35)", color: "#fb923c" }}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-xs font-medium">{remainingPhotos} left</span>
              </button>
            )}
          </div>
        )}

        {/* Upload button (shown when no photos yet, or alongside grid above) */}
        {photos.length === 0 && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-3 rounded-2xl px-4 py-5 transition-colors"
            style={{ background: "rgba(249,115,22,0.07)", border: "1.5px dashed rgba(249,115,22,0.35)", color: "#fb923c" }}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="text-sm font-semibold">Add photos of the problem</span>
          </button>
        )}

        {/* Photo status / error */}
        <div className="flex items-center justify-between">
          {photoError ? (
            <p className="text-xs font-medium" style={{ color: "#fca5a5" }}>{photoError}</p>
          ) : photos.length > 0 ? (
            <p className="text-xs" style={{ color: "#64748b" }}>
              {photos.length} photo{photos.length !== 1 ? "s" : ""} · {totalPhotoMb} MB
            </p>
          ) : (
            <p className="text-xs" style={{ color: "#475569" }}>
              Boiler codes, damp patches, fuse boxes — anything helpful
            </p>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={PHOTO_LIMITS.acceptedMimeTypes.join(",")}
          multiple
          className="sr-only"
          onChange={handlePhotoSelect}
          aria-hidden="true"
        />

        {/* ── Submit ───────────────────────────────────────── */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="relative w-full overflow-hidden rounded-2xl px-4 py-4 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: isSubmitting
              ? "#374151"
              : "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
            boxShadow: isSubmitting ? "none" : "0 4px 24px rgba(249,115,22,0.4)",
          }}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner />
              Sending your details…
            </span>
          ) : (
            "Send details"
          )}
        </button>

        <p className="text-center text-xs" style={{ color: "#334155" }}>
          Your details are stored securely and used only for this booking.
        </p>
      </form>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-bold uppercase tracking-widest"
      style={{ color: "#f97316" }}
    >
      {children}
    </p>
  );
}

function Field({
  id, label, hint, error, children,
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
        <label htmlFor={id} className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
          {label}
        </label>
        {hint && !error && (
          <span className="text-xs" style={{ color: "#475569" }}>{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-xs font-medium" style={{ color: "#fca5a5" }}>
          <svg className="h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return [
    "w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500",
    "focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-0",
    "transition-colors disabled:opacity-50",
    hasError
      ? "border border-red-500/60 bg-red-900/20"
      : "border border-slate-700 bg-slate-800/80 hover:border-slate-600",
  ].join(" ");
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function SuccessState({ alreadyDone = false }: { alreadyDone?: boolean }) {
  return (
    <div
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#0f172a" }}
      className="overflow-hidden rounded-3xl shadow-2xl"
    >
      <div
        style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)" }}
        className="relative overflow-hidden px-6 py-10 text-center"
      >
        <div
          className="pointer-events-none absolute -left-10 -top-10 h-48 w-48 rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, #22c55e, transparent 70%)" }}
        />
        <div className="relative">
          <div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: "rgba(34,197,94,0.15)", border: "1.5px solid rgba(34,197,94,0.3)" }}
          >
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="#22c55e" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">
            {alreadyDone ? "Already submitted" : "We\u2019ve got your details"}
          </h2>
          <p className="mt-2 text-sm" style={{ color: "#94a3b8" }}>
            {alreadyDone
              ? "We already have your details — you\u2019re all set. The agent will continue shortly."
              : "Thanks! Stay on the call \u2014 the agent will continue with your booking right now."}
          </p>
        </div>
      </div>
    </div>
  );
}
