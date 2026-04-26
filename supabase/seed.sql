insert into service_businesses (id, name, phone_number, service_area)
values (
  '00000000-0000-4000-8000-000000000001',
  'Northstar Home Services',
  '+44 20 7946 0182',
  'North London'
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
    now() + interval '1 day',
    now() + interval '1 day' + interval '8 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000102',
    now() + interval '1 day',
    now() + interval '1 day' + interval '8 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000103',
    now() + interval '1 day',
    now() + interval '1 day' + interval '8 hours'
  );
