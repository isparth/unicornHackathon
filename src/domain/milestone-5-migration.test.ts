/**
 * Milestone 5 migration file validation.
 *
 * Reads the SQL migration file and asserts that all expected DDL elements
 * are present.  This catches mistakes like a missing column or table name
 * typo before the migration is applied to a real database.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";

let sql: string;

beforeAll(() => {
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/202604250008_milestone_5_voice_sms_images.sql",
  );
  sql = readFileSync(migrationPath, "utf-8");
});

describe("Milestone 5 migration SQL", () => {
  // ── image_analysis_status enum ───────────────────────────────────────────
  describe("image_analysis_status enum", () => {
    it("creates the image_analysis_status enum type", () => {
      expect(sql).toContain("create type image_analysis_status as enum");
    });

    it("includes all four status values", () => {
      expect(sql).toContain("'pending'");
      expect(sql).toContain("'processing'");
      expect(sql).toContain("'done'");
      expect(sql).toContain("'failed'");
    });

    it("uses idempotent guard (checks pg_type)", () => {
      expect(sql).toContain("pg_type");
      expect(sql).toContain("typname = 'image_analysis_status'");
    });
  });

  // ── uploaded_assets changes ──────────────────────────────────────────────
  describe("uploaded_assets.analysis_status conversion", () => {
    it("drops the old text column", () => {
      expect(sql).toMatch(/drop column if exists analysis_status/);
    });

    it("adds the typed enum column", () => {
      expect(sql).toMatch(/add column if not exists analysis_status image_analysis_status/);
    });
  });

  // ── jobs image analysis columns ──────────────────────────────────────────
  describe("jobs image analysis columns", () => {
    it("adds image_analysis_status column to jobs", () => {
      expect(sql).toMatch(/alter table jobs[\s\S]*?add column if not exists image_analysis_status image_analysis_status/);
    });

    it("adds image_analysis_context jsonb column to jobs", () => {
      expect(sql).toMatch(/add column if not exists image_analysis_context jsonb/);
    });
  });

  // ── outbound_messages table ──────────────────────────────────────────────
  describe("outbound_messages table", () => {
    it("creates the outbound_messages table", () => {
      expect(sql).toContain("create table if not exists outbound_messages");
    });

    it("has a uuid primary key", () => {
      expect(sql).toContain("id uuid primary key default gen_random_uuid()");
    });

    it("has a foreign key to call_sessions", () => {
      expect(sql).toMatch(/call_session_id uuid not null references call_sessions/);
    });

    it("has a nullable foreign key to jobs", () => {
      expect(sql).toMatch(/job_id uuid references jobs/);
    });

    it("has recipient_phone as text not null", () => {
      expect(sql).toMatch(/recipient_phone text not null/);
    });

    it("has message_type as text not null", () => {
      expect(sql).toMatch(/message_type text not null/);
    });

    it("has message_body as text not null", () => {
      expect(sql).toMatch(/message_body text not null/);
    });

    it("has delivery_metadata as jsonb with default", () => {
      expect(sql).toMatch(/delivery_metadata jsonb not null default '\{\}'::jsonb/);
    });

    it("has delivered boolean (nullable)", () => {
      expect(sql).toMatch(/delivered boolean/);
    });

    it("has created_at and updated_at timestamps", () => {
      expect(sql).toMatch(/created_at timestamptz not null default now\(\)/);
      expect(sql).toMatch(/updated_at timestamptz not null default now\(\)/);
    });
  });

  // ── Indexes ──────────────────────────────────────────────────────────────
  describe("indexes", () => {
    it("creates index on outbound_messages(call_session_id)", () => {
      expect(sql).toContain("outbound_messages_call_session_id_idx");
    });

    it("creates index on outbound_messages(job_id)", () => {
      expect(sql).toContain("outbound_messages_job_id_idx");
    });

    it("creates index on outbound_messages(message_type)", () => {
      expect(sql).toContain("outbound_messages_message_type_idx");
    });

    it("creates partial index for undelivered messages", () => {
      expect(sql).toContain("outbound_messages_undelivered_idx");
    });

    it("creates index on uploaded_assets(analysis_status)", () => {
      expect(sql).toContain("uploaded_assets_analysis_status_idx");
    });

    it("creates index on jobs(image_analysis_status)", () => {
      expect(sql).toContain("jobs_image_analysis_status_idx");
    });
  });
});
