insert into service_businesses (id, name, phone_number, service_area)
values (
  '00000000-0000-4000-8000-000000000001',
  'Northstar Home Services',
  '+44 20 7946 0182',
  'North London'
);

insert into customers (
  id,
  service_business_id,
  name,
  phone_number,
  address_line_1,
  city,
  postcode
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000001',
    'Maya Patel',
    '+44 7700 900301',
    '14 Canonbury Lane',
    'London',
    'N1 2AB'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000001',
    'Jon Reed',
    '+44 7700 900302',
    '22 Stoke Newington Road',
    'London',
    'N16 7XN'
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000001',
    'Elena Morris',
    '+44 7700 900303',
    '8 Highbury Grove',
    'London',
    'N5 2EA'
  );

insert into workers (id, service_business_id, name, skill, service_area)
values
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'Amara Lewis',
    'heating',
    'Islington, Camden'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'Theo Grant',
    'plumbing',
    'Hackney, Haringey'
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000001',
    'Priya Shah',
    'electrical',
    'Barnet, Enfield'
  );

insert into availability_windows (id, worker_id, starts_at, ends_at)
values
  (
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000101',
    '2026-04-25T09:00:00Z',
    '2026-04-25T17:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000102',
    '2026-04-25T10:00:00Z',
    '2026-04-25T18:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000103',
    '2026-04-25T12:00:00Z',
    '2026-04-25T20:00:00Z'
  );

insert into jobs (
  id,
  service_business_id,
  customer_id,
  status,
  problem_summary,
  urgency,
  required_skill,
  assigned_worker_id,
  selected_slot_starts_at,
  selected_slot_ends_at,
  price_estimate
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000301',
    'intake',
    'Customer reports no hot water and an error code on the boiler.',
    'same_day',
    'heating',
    null,
    null,
    null,
    null
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000302',
    'priced',
    'Leak under kitchen sink after using the washing machine.',
    'scheduled',
    'plumbing',
    null,
    null,
    null,
    '{"currency":"gbp","calloutFeePence":8000,"repairEstimateMinPence":10000,"repairEstimateMaxPence":25000,"explanation":"Fixed call-out fee plus a non-guaranteed repair range."}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000303',
    'confirmed',
    'Downstairs sockets tripping when kettle is switched on.',
    'emergency',
    'electrical',
    '00000000-0000-4000-8000-000000000103',
    '2026-04-25T14:00:00Z',
    '2026-04-25T16:00:00Z',
    '{"currency":"gbp","calloutFeePence":12000,"repairEstimateMinPence":15000,"repairEstimateMaxPence":35000,"explanation":"Emergency call-out plus likely fault-finding range."}'::jsonb
  );

insert into reservations (
  id,
  job_id,
  worker_id,
  status,
  starts_at,
  ends_at,
  expires_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000103',
  'confirmed',
  '2026-04-25T14:00:00Z',
  '2026-04-25T16:00:00Z',
  '2026-04-25T10:45:00Z',
  '2026-04-25T08:45:00Z',
  '2026-04-25T08:45:00Z'
);

insert into payments (
  id,
  job_id,
  reservation_id,
  status,
  amount_pence,
  currency,
  stripe_checkout_session_id,
  stripe_payment_intent_id
)
values (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000401',
  'paid',
  12000,
  'gbp',
  'cs_test_seed_confirmed_job',
  'pi_test_seed_confirmed_job'
);

update jobs
set
  reservation_id = '00000000-0000-4000-8000-000000000401',
  payment_id = '00000000-0000-4000-8000-000000000501'
where id = '00000000-0000-4000-8000-000000000203';

insert into call_sessions (
  id,
  service_business_id,
  customer_id,
  job_id,
  provider_session_id,
  transcript,
  summary,
  extraction_status
)
values (
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000201',
  'demo-call-001',
  'Customer says the boiler is showing an error code and there is no hot water.',
  'No hot water, boiler error code, same-day heating job.',
  'seeded'
);

insert into uploaded_assets (
  id,
  job_id,
  call_session_id,
  type,
  storage_path,
  analysis_status,
  analysis_result
)
values (
  '00000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000701',
  'transcript',
  'demo/transcripts/demo-call-001.txt',
  'not_required',
  null
);
