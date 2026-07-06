-- RecoveryEngine — Phase 1 schema
-- organizations, users, connected_accounts, disputes, evidence_items,
-- responses, outcomes, webhook_events (idempotency ledger)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Dispute lifecycle: new → evidence_gathering → drafted → submitted → won/lost
create type dispute_status as enum (
  'new',
  'evidence_gathering',
  'drafted',
  'submitted',
  'won',
  'lost'
);

create type outcome_result as enum ('won', 'lost');

create type webhook_event_status as enum ('received', 'processed', 'failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Success fee as a fraction of recovered revenue (e.g. 0.15 = 15%).
  fee_rate    numeric(5, 4) not null default 0.15
              check (fee_rate >= 0 and fee_rate <= 1),
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

create table connected_accounts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations (id) on delete cascade,
  stripe_account_id     text not null unique,
  livemode              boolean not null default false,
  scope                 text not null default 'read_only',
  -- Set once we successfully list disputes on the connected account.
  disputes_access_verified_at timestamptz,
  connected_by          uuid references users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index connected_accounts_org_id_idx on connected_accounts (org_id);

create table disputes (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations (id) on delete cascade,
  connected_account_id  uuid not null references connected_accounts (id) on delete cascade,
  stripe_dispute_id     text not null unique,
  stripe_charge_id      text not null,
  -- Minor units (cents), as Stripe reports them.
  amount                bigint not null,
  currency              text not null,
  -- Stripe reason code: fraudulent, product_not_received, duplicate, ...
  reason                text not null,
  -- Our lifecycle status.
  status                dispute_status not null default 'new',
  -- Stripe's own status (needs_response, under_review, won, lost, ...).
  stripe_status         text not null,
  evidence_due_by       timestamptz,
  is_charge_refundable  boolean,
  livemode              boolean not null default false,
  -- Full dispute object from the latest webhook, for audit/debugging.
  raw                   jsonb not null,
  stripe_created_at     timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index disputes_org_id_idx on disputes (org_id);
create index disputes_status_idx on disputes (org_id, status);
create index disputes_evidence_due_by_idx on disputes (evidence_due_by)
  where status in ('new', 'evidence_gathering', 'drafted');

create table evidence_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  dispute_id  uuid not null references disputes (id) on delete cascade,
  -- e.g. charge, customer, invoice, receipt, shipping, prior_charges
  kind        text not null,
  -- Where the data came from (stripe API resource path, upload, ...).
  source      text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  unique (dispute_id, kind)
);

create index evidence_items_dispute_id_idx on evidence_items (dispute_id);
create index evidence_items_org_id_idx on evidence_items (org_id);

create table responses (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations (id) on delete cascade,
  dispute_id        uuid not null references disputes (id) on delete cascade,
  -- The persuasive narrative produced by the drafting pass.
  narrative         text,
  -- Structured mapping of evidence fields → Stripe dispute evidence object.
  evidence_mapping  jsonb,
  -- Adversarial QA pass output: verdict, critiques, flagged gaps.
  qa_review         jsonb,
  qa_passed         boolean,
  confidence        numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  needs_human_review boolean not null default false,
  submitted_at      timestamptz,
  submitted_by      uuid references users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index responses_dispute_id_idx on responses (dispute_id);
create index responses_org_id_idx on responses (org_id);

create table outcomes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations (id) on delete cascade,
  dispute_id        uuid not null unique references disputes (id) on delete cascade,
  result            outcome_result not null,
  -- Minor units. Amount recovered = dispute amount when won, 0 when lost.
  amount_recovered  bigint not null default 0,
  -- Our success fee at the org's fee_rate, computed at close time.
  fee_amount        bigint not null default 0,
  closed_at         timestamptz not null,
  created_at        timestamptz not null default now()
);

create index outcomes_org_id_idx on outcomes (org_id);

-- Idempotency ledger for Stripe webhooks: one row per Stripe event id.
create table webhook_events (
  id               uuid primary key default gen_random_uuid(),
  stripe_event_id  text not null unique,
  type             text not null,
  stripe_account   text,
  status           webhook_event_status not null default 'received',
  error            text,
  payload          jsonb not null,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
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
create trigger connected_accounts_updated_at before update on connected_accounts
  for each row execute function set_updated_at();
create trigger disputes_updated_at before update on disputes
  for each row execute function set_updated_at();
create trigger responses_updated_at before update on responses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- New-user provisioning: every auth signup gets an organization + users row.
-- Works for email/password and Google OAuth alike.
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
  values (
    new.id,
    new_org_id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security: users can only see rows belonging to their org.
-- The service-role key (webhooks, background jobs) bypasses RLS.
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table users enable row level security;
alter table connected_accounts enable row level security;
alter table disputes enable row level security;
alter table evidence_items enable row level security;
alter table responses enable row level security;
alter table outcomes enable row level security;
alter table webhook_events enable row level security;

-- Helper: the calling user's org id. security definer so it can read users
-- without recursive RLS evaluation.
create or replace function public.current_org_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select org_id from users where id = auth.uid();
$$;

create policy "org members can read their organization"
  on organizations for select
  using (id = public.current_org_id());

create policy "org members can update their organization"
  on organizations for update
  using (id = public.current_org_id());

create policy "users can read members of their org"
  on users for select
  using (org_id = public.current_org_id());

create policy "users can update their own row"
  on users for update
  using (id = auth.uid());

create policy "org members can read connected accounts"
  on connected_accounts for select
  using (org_id = public.current_org_id());

create policy "org members can read disputes"
  on disputes for select
  using (org_id = public.current_org_id());

create policy "org members can update dispute status"
  on disputes for update
  using (org_id = public.current_org_id());

create policy "org members can read evidence"
  on evidence_items for select
  using (org_id = public.current_org_id());

create policy "org members can read responses"
  on responses for select
  using (org_id = public.current_org_id());

create policy "org members can edit responses"
  on responses for update
  using (org_id = public.current_org_id());

create policy "org members can read outcomes"
  on outcomes for select
  using (org_id = public.current_org_id());

-- webhook_events: service-role only (no user-facing policies).
