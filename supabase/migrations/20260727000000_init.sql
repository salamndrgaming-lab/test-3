-- AgentLens — Phase 1 schema
-- organizations, users, api_keys, agents, runs, run_events, analyses,
-- ingest_events (idempotency ledger)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Run lifecycle: running → completed | failed | timeout | canceled
create type run_status as enum (
  'running',
  'completed',
  'failed',
  'timeout',
  'canceled'
);

create type ingest_event_status as enum ('received', 'processed', 'failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'free' check (plan in ('free', 'pro')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table users (
  id          uuid primary key references auth.users (id) on delete cascade,
  org_id      uuid not null references organizations (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'owner' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now()
);

create index users_org_id_idx on users (org_id);

-- Ingest API keys. Only a sha256 hash is stored; the plaintext key is shown
-- exactly once at creation.
create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  name         text not null,
  key_prefix   text not null,
  key_hash     text not null unique,
  created_by   uuid references users (id) on delete set null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index api_keys_org_id_idx on api_keys (org_id);

-- One row per agent the customer runs (identified by their external id).
create table agents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  external_id  text not null,
  name         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, external_id)
);

create index agents_org_id_idx on agents (org_id);

create table runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id) on delete cascade,
  agent_id        uuid not null references agents (id) on delete cascade,
  external_run_id text not null,
  status          run_status not null default 'running',
  started_at      timestamptz not null,
  ended_at        timestamptz,
  model           text,
  input_tokens    bigint,
  output_tokens   bigint,
  -- Estimated cost in USD micro-dollars (1e-6 USD) to avoid float drift.
  cost_micro_usd  bigint,
  error           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, external_run_id)
);

create index runs_org_id_idx on runs (org_id);
create index runs_agent_id_idx on runs (agent_id);
create index runs_status_idx on runs (org_id, status);
create index runs_started_at_idx on runs (org_id, started_at desc);

-- Ordered trace events within a run (llm calls, tool calls, errors, logs).
create table run_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  run_id      uuid not null references runs (id) on delete cascade,
  seq         integer not null,
  type        text not null check (type in ('llm_call', 'tool_call', 'error', 'log', 'custom')),
  name        text,
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);

create index run_events_run_id_idx on run_events (run_id, seq);
create index run_events_org_id_idx on run_events (org_id);

-- AI failure diagnosis (filled by the Phase 3 engine).
create table analyses (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id) on delete cascade,
  run_id             uuid not null unique references runs (id) on delete cascade,
  diagnosis          text,
  root_cause         text,
  suggested_fix      text,
  qa_review          jsonb,
  qa_passed          boolean,
  confidence         numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  needs_human_review boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index analyses_org_id_idx on analyses (org_id);

-- Idempotency ledger: one row per (org, Idempotency-Key) ingest request.
create table ingest_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id) on delete cascade,
  idempotency_key text not null,
  status          ingest_event_status not null default 'received',
  error           text,
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  unique (org_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger agents_updated_at before update on agents
  for each row execute function set_updated_at();
create trigger runs_updated_at before update on runs
  for each row execute function set_updated_at();
create trigger analyses_updated_at before update on analyses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- New-user provisioning: every auth signup gets an organization + users row.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name)
  values (coalesce(new.raw_user_meta_data ->> 'company', split_part(new.email, '@', 1)))
  returning id into new_org_id;

  insert into users (id, org_id, email, full_name)
  values (new.id, new_org_id, new.email, new.raw_user_meta_data ->> 'full_name');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security: users only see rows belonging to their org.
-- The service-role key (ingest, background jobs) bypasses RLS.
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table users enable row level security;
alter table api_keys enable row level security;
alter table agents enable row level security;
alter table runs enable row level security;
alter table run_events enable row level security;
alter table analyses enable row level security;
alter table ingest_events enable row level security;

create or replace function public.current_org_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select org_id from users where id = auth.uid();
$$;

create policy "org members can read their organization"
  on organizations for select using (id = public.current_org_id());
create policy "org members can update their organization"
  on organizations for update using (id = public.current_org_id());

create policy "users can read members of their org"
  on users for select using (org_id = public.current_org_id());
create policy "users can update their own row"
  on users for update using (id = auth.uid());

create policy "org members can read api keys"
  on api_keys for select using (org_id = public.current_org_id());

create policy "org members can read agents"
  on agents for select using (org_id = public.current_org_id());

create policy "org members can read runs"
  on runs for select using (org_id = public.current_org_id());

create policy "org members can read run events"
  on run_events for select using (org_id = public.current_org_id());

create policy "org members can read analyses"
  on analyses for select using (org_id = public.current_org_id());

-- ingest_events: service-role only (no user-facing policies).
