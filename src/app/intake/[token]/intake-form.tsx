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
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  borderRadius: 20,
  background: "#0f1623",
  border: "1px solid rgba(255,255,255,0.08)",
  overflow: "hidden",
  boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
};

const inputBase: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  fontSize: 15,
  color: "#f0f4ff",
  background: "#161e2e",
  border: "1px solid rgba(255,255,255,0.1)",
  outline: "none",
  transition: "border-color 0.15s",
};

const inputError: React.CSSProperties = {
  ...inputBase,
  border: "1px solid rgba(239,68,68,0.5)",
  background: "rgba(239,68,68,0.05)",
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

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
    }
  }

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
          dataUrl: previewUrl,
          previewUrl,
        });
      }

      setPhotos((prev) => [...prev, ...incoming]);
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

  if (formState.stage === "success") return <SuccessState />;

  const isSubmitting = formState.stage === "submitting" || isPending;
  const remainingPhotos = PHOTO_LIMITS.maxCount - photos.length;
  const totalPhotoMb = (photos.reduce((s, p) => s + p.sizeBytes, 0) / (1024 * 1024)).toFixed(1);

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ padding: "28px 24px 24px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "linear-gradient(135deg, #161e2e 0%, #0f1623 100%)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 100, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", marginBottom: 14 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", boxShadow: "0 0 6px #6366f1" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#a5b4fc", letterSpacing: "0.04em" }}>LIVE CALL IN PROGRESS</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 6px", color: "#f0f4ff" }}>Your booking details</h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0, lineHeight: 1.5 }}>Fill this in while we're on the call — takes under a minute.</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Error banner */}
        {formState.stage === "error" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 13 }}>
            <svg style={{ width: 15, height: 15, marginTop: 1, flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            {formState.result.message}
          </div>
        )}

        {/* About you */}
        <SectionLabel>About you</SectionLabel>

        <Field id="name" label="Full name" error={fieldErrors.name}>
          <input id="name" name="name" type="text" autoComplete="name" autoCapitalize="words"
            value={fields.name} onChange={handleChange} placeholder="Sarah Jones"
            style={fieldErrors.name ? inputError : inputBase} />
        </Field>

        <Field id="phoneNumber" label="Phone number" hint="Confirm the number we can reach you on" error={fieldErrors.phoneNumber}>
          <input id="phoneNumber" name="phoneNumber" type="tel" autoComplete="tel" inputMode="tel"
            value={fields.phoneNumber} onChange={handleChange} placeholder="+44 7700 900123"
            style={fieldErrors.phoneNumber ? inputError : inputBase} />
        </Field>

        {/* Address */}
        <SectionLabel>Your address</SectionLabel>

        <Field id="addressLine1" label="Street address" error={fieldErrors.addressLine1}>
          <input id="addressLine1" name="addressLine1" type="text" autoComplete="address-line1" autoCapitalize="words"
            value={fields.addressLine1} onChange={handleChange} placeholder="14 Oak Street"
            style={fieldErrors.addressLine1 ? inputError : inputBase} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 12 }}>
          <Field id="city" label="City" error={fieldErrors.city}>
            <input id="city" name="city" type="text" autoComplete="address-level2" autoCapitalize="words"
              value={fields.city} onChange={handleChange} placeholder="London"
              style={fieldErrors.city ? inputError : inputBase} />
          </Field>
          <Field id="postcode" label="Postcode" error={fieldErrors.postcode}>
            <input id="postcode" name="postcode" type="text" autoComplete="postal-code" autoCapitalize="characters"
              value={fields.postcode} onChange={handleChange} placeholder="N1 2AB"
              style={fieldErrors.postcode ? inputError : inputBase} />
          </Field>
        </div>

        {/* Photos */}
        <SectionLabel>
          Photos{" "}
          <span style={{ fontWeight: 400, fontSize: 11, color: "#475569", letterSpacing: "0.02em" }}>
            optional · up to {PHOTO_LIMITS.maxCount} · 10 MB total
          </span>
        </SectionLabel>

        {photos.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {photos.map((p) => (
              <div key={p.id} style={{ position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt={p.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button
                  type="button" onClick={() => removePhoto(p.id)}
                  aria-label={`Remove ${p.fileName}`}
                  style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: "rgba(8,12,20,0.85)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#f0f4ff" }}
                >
                  <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
            {remainingPhotos > 0 && (
              <button type="button" onClick={() => fileInputRef.current?.click()}
                style={{ aspectRatio: "1", borderRadius: 10, background: "rgba(99,102,241,0.06)", border: "1.5px dashed rgba(99,102,241,0.3)", color: "#6366f1", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11, fontWeight: 500 }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                {remainingPhotos} left
              </button>
            )}
          </div>
        )}

        {photos.length === 0 && (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            style={{ width: "100%", padding: "18px", borderRadius: 12, background: "rgba(99,102,241,0.06)", border: "1.5px dashed rgba(99,102,241,0.25)", color: "#6366f1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 14, fontWeight: 500 }}>
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            Add photos of the problem
          </button>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: -8 }}>
          {photoError ? (
            <p style={{ fontSize: 12, color: "#fca5a5", margin: 0 }}>{photoError}</p>
          ) : photos.length > 0 ? (
            <p style={{ fontSize: 12, color: "#475569", margin: 0 }}>{photos.length} photo{photos.length !== 1 ? "s" : ""} · {totalPhotoMb} MB</p>
          ) : (
            <p style={{ fontSize: 12, color: "#334155", margin: 0 }}>Boiler codes, damp patches, fuse boxes — anything helpful</p>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept={PHOTO_LIMITS.acceptedMimeTypes.join(",")}
          multiple style={{ display: "none" }} onChange={handlePhotoSelect} aria-hidden="true" />

        {/* Submit */}
        <button
          type="submit" disabled={isSubmitting}
          style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none", cursor: isSubmitting ? "not-allowed" : "pointer",
            background: isSubmitting ? "#1e293b" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: isSubmitting ? "#64748b" : "#fff", fontWeight: 600, fontSize: 16,
            boxShadow: isSubmitting ? "none" : "0 8px 24px rgba(99,102,241,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? <><Spinner /> Sending your details…</> : "Send details"}
        </button>

        <p style={{ textAlign: "center", fontSize: 12, color: "#1e293b", margin: 0 }}>
          Your details are stored securely and used only for this booking.
        </p>
      </form>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6366f1", margin: 0 }}>
      {children}
    </p>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{label}</label>
        {hint && !error && <span style={{ fontSize: 11, color: "#475569" }}>{hint}</span>}
      </div>
      {children}
      {error && (
        <p style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, color: "#fca5a5", margin: 0 }}>
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function SuccessState({ alreadyDone = false }: { alreadyDone?: boolean }) {
  return (
    <div style={{ borderRadius: 20, background: "#0f1623", border: "1px solid rgba(255,255,255,0.08)", padding: "48px 28px", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
      {/* Check icon */}
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#22c55e" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#f0f4ff", margin: "0 0 10px" }}>
        {alreadyDone ? "Already submitted" : "We've got your details"}
      </h2>
      <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
        {alreadyDone
          ? "We already have your details — you're all set. The agent will continue shortly."
          : "Thanks! Stay on the call — the agent will continue with your booking right now."}
      </p>
    </div>
  );
}
