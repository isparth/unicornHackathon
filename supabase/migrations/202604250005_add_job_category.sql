-- Migration: Add job_category column to jobs
--
-- Stores the short human-readable classification label produced by the
-- Classification Service (e.g. "Boiler repair", "Leak investigation").
-- Required_skill and urgency already exist; this adds the third output.

alter table jobs
  add column if not exists job_category text;
