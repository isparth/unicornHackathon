-- Milestone 2: add intake form token columns to call_sessions
-- These replace the AI transcript extraction approach with a customer-facing form.

alter table call_sessions
  add column intake_form_token text,
  add column intake_form_token_expires_at timestamptz,
  add column intake_form_completed_at timestamptz;

-- Unique index so we can look up a session by its token without a full scan,
-- and so we can enforce that a given token is only stored once.
create unique index call_sessions_intake_form_token_idx
  on call_sessions(intake_form_token)
  where intake_form_token is not null;
