create extension if not exists "pgcrypto";

create type job_status as enum (
  'intake',
  'qualified',
  'priced',
  'slot_held',
  'awaiting_payment',
  'confirmed',
  'expired',
  'completed'
);

create type payment_status as enum (
  'pending',
  'paid',
  'failed',
  'refunded'
);

create type urgency as enum (
  'emergency',
  'same_day',
  'scheduled'
);

create type reservation_status as enum (
  'held',
  'released',
  'expired',
  'confirmed'
);

create type worker_skill as enum (
  'plumbing',
  'heating',
  'electrical'
);

create type uploaded_asset_type as enum (
  'image',
  'transcript',
  'document'
);

create table service_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text not null,
  service_area text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  service_business_id uuid not null references service_businesses(id) on delete cascade,
  name text,
  phone_number text not null,
  address_line_1 text,
  city text,
  postcode text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workers (
  id uuid primary key default gen_random_uuid(),
  service_business_id uuid not null references service_businesses(id) on delete cascade,
  name text not null,
  skill worker_skill not null,
  service_area text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  service_business_id uuid not null references service_businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  status job_status not null default 'intake',
  problem_summary text,
  urgency urgency,
  required_skill worker_skill,
  assigned_worker_id uuid references workers(id) on delete set null,
  selected_slot_starts_at timestamptz,
  selected_slot_ends_at timestamptz,
  price_estimate jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint selected_slot_has_end check (
    selected_slot_starts_at is null
    or selected_slot_ends_at is not null
  ),
  constraint selected_slot_order check (
    selected_slot_starts_at is null
    or selected_slot_ends_at > selected_slot_starts_at
  )
);

create table call_sessions (
  id uuid primary key default gen_random_uuid(),
  service_business_id uuid not null references service_businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  provider_session_id text,
  transcript text,
  event_history jsonb not null default '[]'::jsonb,
  summary text,
  extraction_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table availability_windows (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_window_order check (ends_at > starts_at)
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  worker_id uuid not null references workers(id) on delete restrict,
  status reservation_status not null default 'held',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_window_order check (ends_at > starts_at),
  constraint reservation_expiry_order check (expires_at > created_at)
);

alter table jobs
  add column reservation_id uuid references reservations(id) on delete set null;

create table payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  status payment_status not null default 'pending',
  amount_pence integer not null,
  currency text not null default 'gbp',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint positive_payment_amount check (amount_pence > 0)
);

alter table jobs
  add column payment_id uuid references payments(id) on delete set null;

create table uploaded_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  call_session_id uuid references call_sessions(id) on delete cascade,
  type uploaded_asset_type not null,
  storage_path text not null,
  analysis_status text,
  analysis_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uploaded_asset_owner check (
    job_id is not null
    or call_session_id is not null
  )
);

create index customers_service_business_id_idx on customers(service_business_id);
create index call_sessions_provider_session_id_idx on call_sessions(provider_session_id);
create index call_sessions_job_id_idx on call_sessions(job_id);
create index jobs_status_idx on jobs(status);
create index jobs_customer_id_idx on jobs(customer_id);
create index jobs_required_skill_idx on jobs(required_skill);
create index workers_skill_idx on workers(skill);
create index workers_active_skill_idx on workers(active, skill);
create index availability_windows_worker_time_idx on availability_windows(worker_id, starts_at, ends_at);
create index reservations_expiry_idx on reservations(expires_at) where status = 'held';
create index reservations_worker_time_idx on reservations(worker_id, starts_at, ends_at);
create index reservations_job_id_idx on reservations(job_id);
create unique index payments_stripe_checkout_session_id_idx
  on payments(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index payments_stripe_payment_intent_id_idx
  on payments(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index uploaded_assets_job_id_idx on uploaded_assets(job_id);
create index uploaded_assets_call_session_id_idx on uploaded_assets(call_session_id);
