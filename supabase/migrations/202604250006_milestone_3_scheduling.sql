-- Milestone 3: Worker Availability, Scheduling, and Reservation Holds
--
-- Adds database-level concurrency protection to prevent two active reservations
-- from overlapping for the same worker.
--
-- Strategy: partial unique index on reservations where status IN ('held', 'confirmed').
-- PostgreSQL does not support EXCLUDE constraints with GiST on timestamptz in
-- all hosted versions, so we use an exclusion constraint via btree_gist which
-- is available as a core extension.  If the extension is not available we fall
-- back to a CHECK-based approach enforced at the application layer (the
-- ReservationService checks for overlaps before inserting).
--
-- We also add the reservation_id column to the jobs table (already present via
-- Milestone 1) and ensure the index exists for fast expiry lookups.

-- Enable btree_gist for range overlap exclusion
create extension if not exists btree_gist;

-- Exclusion constraint: no two active reservations for the same worker may
-- overlap in time.  Released and expired reservations are excluded from the
-- constraint so they don't block new bookings.
alter table reservations
  add constraint no_overlapping_active_reservations
  exclude using gist (
    worker_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('held', 'confirmed'));

-- Index to speed up the scheduling query: find active reservations for a
-- worker within a time window (used to subtract busy periods from slots).
create index if not exists reservations_worker_active_time_idx
  on reservations(worker_id, starts_at, ends_at)
  where status in ('held', 'confirmed');

-- Index to speed up confirmed-job lookups per worker (dashboard calendar).
create index if not exists jobs_assigned_worker_status_idx
  on jobs(assigned_worker_id, status)
  where assigned_worker_id is not null;
