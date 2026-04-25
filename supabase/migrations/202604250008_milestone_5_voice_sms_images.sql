-- Milestone 5: Voice, SMS Handoff, and Image Analysis — Schema additions
--
-- Changes:
--   1. New enum: image_analysis_status
--      Replaces the loose text column on uploaded_assets and is also used on
--      jobs so the dashboard can surface per-job analysis state at a glance.
--
--   2. uploaded_assets.analysis_status → image_analysis_status enum
--      The column already exists as text; we convert it to the new enum so
--      the image-analysis service can enforce valid states at the DB level.
--
--   3. New columns on jobs
--      image_analysis_status  — aggregate status across all assets for this job
--      image_analysis_context — free-form jsonb written by the analysis service;
--                               never overwrites problem_summary or form data
--
--   4. New table: outbound_messages
--      Tracks every SMS (or other message) sent during a call session so the
--      dashboard and support team can see what was delivered and when.
--      Stores: recipient phone, message type/template, body, delivery metadata.
--
-- Idempotency:
--   All DDL uses IF NOT EXISTS / IF EXISTS guards where Postgres supports them.
--   The enum-column conversion is handled with explicit USING cast so it is
--   safe to run against an existing populated database (values must already
--   match the enum labels — 'pending', 'processing', 'done', 'failed', or NULL).

-- ─── 1. image_analysis_status enum ──────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'image_analysis_status'
  ) then
    create type image_analysis_status as enum (
      'pending',
      'processing',
      'done',
      'failed'
    );
  end if;
end$$;

-- ─── 2. Convert uploaded_assets.analysis_status to the new enum ─────────────

-- Step 2a: Drop the old text column
alter table uploaded_assets
  drop column if exists analysis_status;

-- Step 2b: Add it back typed as the new enum
alter table uploaded_assets
  add column if not exists analysis_status image_analysis_status;

-- ─── 3. Add image analysis columns to jobs ──────────────────────────────────

alter table jobs
  add column if not exists image_analysis_status image_analysis_status;

-- Stores image-derived context appended by the analysis service.
-- This is supplemental — it never overwrites problem_summary or form data.
alter table jobs
  add column if not exists image_analysis_context jsonb;

-- ─── 4. outbound_messages table ─────────────────────────────────────────────

-- Tracks outbound SMS (and future notification types) for each call session.
-- message_type is a free-form label matching the SMS service template names:
--   'intake_form_link', 'image_upload_link', 'payment_link', 'booking_confirmation'
-- delivery_metadata holds provider-specific data (Vapi message id, Twilio SID, etc.)

create table if not exists outbound_messages (
  id uuid primary key default gen_random_uuid(),

  -- Owning call session (always set — messages are sent in the context of a call)
  call_session_id uuid not null references call_sessions(id) on delete cascade,

  -- Related job (denormalised for easy dashboard queries; mirrors call_session.job_id)
  job_id uuid references jobs(id) on delete set null,

  -- Recipient phone number in E.164 format
  recipient_phone text not null,

  -- Template / category label — checked by the application layer
  message_type text not null,

  -- The rendered message body (stored so support can see exactly what was sent)
  message_body text not null,

  -- Provider-level delivery information (e.g. Vapi message id, status, error)
  delivery_metadata jsonb not null default '{}'::jsonb,

  -- Whether the provider accepted the message (true = accepted; false = rejected/error)
  -- NULL means we haven't received a delivery receipt yet.
  delivered boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

-- Look up all messages sent during a call session
create index if not exists outbound_messages_call_session_id_idx
  on outbound_messages(call_session_id);

-- Look up all messages related to a job (for the job detail view)
create index if not exists outbound_messages_job_id_idx
  on outbound_messages(job_id)
  where job_id is not null;

-- Find all messages of a given type (e.g. "how many intake form links were sent today?")
create index if not exists outbound_messages_message_type_idx
  on outbound_messages(message_type, created_at desc);

-- Partial index: find undelivered messages quickly (for retry / troubleshooting)
create index if not exists outbound_messages_undelivered_idx
  on outbound_messages(created_at desc)
  where delivered is false or delivered is null;

-- Speed up uploads_assets lookups by analysis status (e.g. find all pending assets)
create index if not exists uploaded_assets_analysis_status_idx
  on uploaded_assets(analysis_status)
  where analysis_status is not null;

-- Speed up jobs filtered by image_analysis_status
create index if not exists jobs_image_analysis_status_idx
  on jobs(image_analysis_status)
  where image_analysis_status is not null;
