-- Migration: Create job-photos Storage bucket with RLS
--
-- Creates a private bucket for job-related photo uploads.
-- Only the service role (server-side) can insert and read objects.
-- Customers cannot list or read files directly — signed URLs are
-- generated server-side when needed.

-- Create the bucket (private by default — public = false)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-photos',
  'job-photos',
  false,
  5242880, -- 5 MB per file (matches PHOTO_LIMITS.maxSingleBytes)
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- RLS: service role can INSERT (upload) objects
create policy "service role can upload job photos"
  on storage.objects
  for insert
  to service_role
  with check (bucket_id = 'job-photos');

-- RLS: service role can SELECT (read/download) objects
create policy "service role can read job photos"
  on storage.objects
  for select
  to service_role
  using (bucket_id = 'job-photos');

-- RLS: service role can DELETE objects (e.g. on job cancellation)
create policy "service role can delete job photos"
  on storage.objects
  for delete
  to service_role
  using (bucket_id = 'job-photos');
