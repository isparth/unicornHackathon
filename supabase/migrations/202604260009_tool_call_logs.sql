-- Tool call logs: records every Vapi tool invocation for debugging + demo display
create table tool_call_logs (
  id          uuid primary key default gen_random_uuid(),
  call_id     text,                     -- Vapi call ID
  job_id      uuid references jobs(id) on delete set null,
  session_id  uuid references call_sessions(id) on delete set null,
  tool_name   text not null,            -- e.g. 'create-call-session'
  args        jsonb not null default '{}'::jsonb,  -- tool arguments (scrubbed of secrets)
  result      jsonb,                    -- tool response (success/failure payload)
  success     boolean,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index tool_call_logs_job_id_idx     on tool_call_logs(job_id);
create index tool_call_logs_session_id_idx on tool_call_logs(session_id);
create index tool_call_logs_created_at_idx on tool_call_logs(created_at desc);
create index tool_call_logs_call_id_idx    on tool_call_logs(call_id);

alter table tool_call_logs enable row level security;
