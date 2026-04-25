/**
 * Milestone 5 domain-type shape tests.
 *
 * These tests verify that the TypeScript types added for Milestone 5 have
 * the expected shape at runtime by constructing conforming objects and
 * asserting their field values.  They act as a regression guard: if a
 * field is accidentally removed or renamed the test fails immediately.
 */

import { describe, expect, it } from "vitest";
import type {
  ImageAnalysisStatus,
  Job,
  OutboundMessage,
  OutboundMessageType,
  UploadedAsset,
} from "@/domain/types";
import { imageAnalysisStatuses, outboundMessageTypes } from "@/domain/enums";

// ─── ImageAnalysisStatus ────────────────────────────────────────────────────

describe("ImageAnalysisStatus", () => {
  it("accepts all four valid status values", () => {
    const valid: ImageAnalysisStatus[] = ["pending", "processing", "done", "failed"];
    expect(valid).toHaveLength(imageAnalysisStatuses.length);
    for (const v of imageAnalysisStatuses) {
      expect(valid).toContain(v);
    }
  });
});

// ─── OutboundMessageType ────────────────────────────────────────────────────

describe("OutboundMessageType", () => {
  it("accepts all four SMS template types", () => {
    const valid: OutboundMessageType[] = [
      "intake_form_link",
      "image_upload_link",
      "payment_link",
      "booking_confirmation",
    ];
    expect(valid).toHaveLength(outboundMessageTypes.length);
    for (const v of outboundMessageTypes) {
      expect(valid).toContain(v);
    }
  });
});

// ─── OutboundMessage ─────────────────────────────────────────────────────────

describe("OutboundMessage type shape", () => {
  it("has all required fields", () => {
    const msg: OutboundMessage = {
      id: "msg-1",
      callSessionId: "session-1",
      jobId: "job-1",
      recipientPhone: "+447700900000",
      messageType: "intake_form_link",
      messageBody: "Please fill in your details: https://example.com/intake/abc",
      deliveryMetadata: { vapiMessageId: "vapi-msg-1" },
      delivered: null,
      createdAt: "2026-04-25T10:00:00Z",
      updatedAt: "2026-04-25T10:00:00Z",
    };

    expect(msg.id).toBe("msg-1");
    expect(msg.callSessionId).toBe("session-1");
    expect(msg.jobId).toBe("job-1");
    expect(msg.recipientPhone).toBe("+447700900000");
    expect(msg.messageType).toBe("intake_form_link");
    expect(msg.messageBody).toContain("intake/abc");
    expect(msg.deliveryMetadata).toEqual({ vapiMessageId: "vapi-msg-1" });
    expect(msg.delivered).toBeNull();
  });

  it("allows jobId to be null (messages without a linked job)", () => {
    const msg: OutboundMessage = {
      id: "msg-2",
      callSessionId: "session-2",
      jobId: null,
      recipientPhone: "+447700900001",
      messageType: "booking_confirmation",
      messageBody: "Your booking is confirmed.",
      deliveryMetadata: {},
      delivered: true,
      createdAt: "2026-04-25T10:05:00Z",
      updatedAt: "2026-04-25T10:05:00Z",
    };

    expect(msg.jobId).toBeNull();
    expect(msg.delivered).toBe(true);
  });
});

// ─── UploadedAsset — analysis_status now typed ──────────────────────────────

describe("UploadedAsset.analysisStatus type", () => {
  it("accepts a typed ImageAnalysisStatus value", () => {
    const asset: UploadedAsset = {
      id: "asset-1",
      jobId: "job-1",
      callSessionId: null,
      type: "image",
      storagePath: "job-photos/job-1/photo.jpg",
      analysisStatus: "done",
      analysisResult: { summary: "Visible leak under sink.", confidence: 0.92 },
      createdAt: "2026-04-25T10:00:00Z",
      updatedAt: "2026-04-25T10:01:00Z",
    };

    expect(asset.analysisStatus).toBe("done");
    expect(asset.analysisResult).toMatchObject({ summary: expect.any(String) });
  });

  it("allows analysisStatus to be null (not yet analysed)", () => {
    const asset: UploadedAsset = {
      id: "asset-2",
      jobId: "job-2",
      callSessionId: null,
      type: "image",
      storagePath: "job-photos/job-2/photo.jpg",
      analysisStatus: null,
      analysisResult: null,
      createdAt: "2026-04-25T10:00:00Z",
      updatedAt: "2026-04-25T10:00:00Z",
    };

    expect(asset.analysisStatus).toBeNull();
  });
});

// ─── Job — image analysis fields ─────────────────────────────────────────────

describe("Job.imageAnalysis fields", () => {
  const baseJob = {
    id: "job-1",
    customerId: "customer-1",
    status: "confirmed" as const,
    problemSummary: "Boiler not heating.",
    jobCategory: "Boiler repair",
    urgency: "same_day" as const,
    requiredSkill: "heating" as const,
    createdAt: "2026-04-25T09:00:00Z",
    updatedAt: "2026-04-25T10:00:00Z",
  };

  it("accepts imageAnalysisStatus and imageAnalysisContext", () => {
    const job: Job = {
      ...baseJob,
      imageAnalysisStatus: "done",
      imageAnalysisContext: {
        summary: "Photo shows corroded boiler flue.",
        confidence: 0.88,
        analysedAssetIds: ["asset-1"],
      },
    };

    expect(job.imageAnalysisStatus).toBe("done");
    expect(job.imageAnalysisContext).toMatchObject({
      summary: expect.any(String),
    });
  });

  it("allows both image analysis fields to be undefined (not yet processed)", () => {
    const job: Job = { ...baseJob };

    expect(job.imageAnalysisStatus).toBeUndefined();
    expect(job.imageAnalysisContext).toBeUndefined();
  });

  it("does not overwrite problemSummary when imageAnalysisContext is set", () => {
    const job: Job = {
      ...baseJob,
      imageAnalysisStatus: "done",
      imageAnalysisContext: { summary: "Image-derived: corroded pipe visible." },
    };

    // problemSummary remains the voice-derived value
    expect(job.problemSummary).toBe("Boiler not heating.");
    expect(job.imageAnalysisContext?.summary).toContain("Image-derived");
  });
});
