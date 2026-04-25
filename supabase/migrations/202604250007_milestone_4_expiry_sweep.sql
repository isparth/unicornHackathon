-- Milestone 4: Reservation Expiry Sweep (pg_cron)
--
-- Installs a pg_cron job that runs every minute and sweeps any reservations
-- that are still 'held' but whose expires_at timestamp has already passed.
--
-- Design:
--   - The primary correctness guarantee is lazy expiry in the application layer
--     (reservation-service.ts getReservation / hasOverlappingReservation).
--     An expired slot can NEVER appear as bookable even before this sweep runs.
--   - This sweep keeps the database state clean and consistent so that:
--       a) Dashboards show accurate statuses without stale 'held' rows.
--       b) The DB-level exclusion constraint (no_overlapping_active_reservations)
--          on reservations (status IN ('held','confirmed')) eventually releases
--          the expired row from the constraint scope, allowing new bookings even
--          without the app-layer filter.
--
-- Idempotency:
--   - Both UPDATE statements use a WHERE clause that only matches rows still in
--     the old state, so replaying the sweep produces no additional transitions.
--   - Running the app-layer expiry AND this sweep on the same reservation is
--     safe: the second write is a no-op because the WHERE no longer matches.
--
-- Supabase note:
--   pg_cron is available on Supabase Pro and above.  On free-tier projects this
--   migration will still apply the expire_stale_reservations() function but the
--   cron.schedule() call will error if the pg_cron extension is not available.
--   In that case remove the cron.schedule block and call the function manually
--   or via a Supabase Edge Function on a schedule.

-- Enable pg_cron (no-op if already enabled)
create extension if not exists pg_cron;

-- ─── Sweep function ──────────────────────────────────────────────────────────

create or replace function expire_stale_reservations()
returns void
language plpgsql
security definer
as $$
declare
  expired_ids uuid[];
begin
  -- 1. Collect all held reservations whose hold window has passed
  select array_agg(id)
  into   expired_ids
  from   reservations
  where  status    = 'held'
  and    expires_at < now();

  -- Nothing to do
  if expired_ids is null or array_length(expired_ids, 1) = 0 then
    return;
  end if;

  -- 2. Mark those reservations as expired
  update reservations
  set    status     = 'expired',
         updated_at = now()
  where  id = any(expired_ids)
  and    status = 'held';  -- idempotency guard

  -- 3. Move the linked jobs to 'expired'
  --    Only transitions jobs that are still in slot_held or awaiting_payment
  --    (i.e. still waiting for payment) and are linked to one of the expired
  --    reservations.  Confirmed or already-expired jobs are untouched.
  update jobs
  set    status     = 'expired',
         updated_at = now()
  where  reservation_id = any(expired_ids)
  and    status in ('slot_held', 'awaiting_payment');  -- idempotency guard
end;
$$;

-- ─── Schedule the sweep ──────────────────────────────────────────────────────

-- Run expire_stale_reservations() every minute in the postgres database.
-- The cron.schedule call is idempotent: if a job with this name already
-- exists it will be replaced with the current definition.
select cron.schedule(
  'expire-stale-reservations',   -- job name (unique key)
  '* * * * *',                   -- every minute
  $$select expire_stale_reservations()$$
);

-- ─── Index to make the sweep fast ────────────────────────────────────────────

-- The sweep WHERE clause filters on status='held' AND expires_at < now().
-- This partial index makes that scan O(expired rows) rather than a full table scan.
create index if not exists reservations_held_expires_at_idx
  on reservations(expires_at)
  where status = 'held';
