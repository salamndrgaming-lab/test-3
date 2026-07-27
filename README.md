# AgentLens

Observability and AI-powered failure diagnosis for production AI agents.
Teams stream their agents' runs and trace events into AgentLens; when a run
fails, an AI engine diagnoses the failure from the trace and proposes a fix.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Supabase (auth + Postgres + RLS) · Anthropic API · Tailwind + shadcn/ui · Vercel

## Status

- ✅ **Phase 1 — Foundation**: auth (email + Google), org auto-provisioning,
  hashed + revocable API keys, verified + idempotent ingest API, full schema
  with run lifecycle enum, dashboard (runs, key management)
- ⬜ Phase 2 — Trace Engine (normalized trace bundles, failure taxonomy)
- ⬜ Phase 3 — AI Diagnosis Engine (two-pass, adversarial QA, no fabrication)
- ⬜ Phase 4 — Dashboard (failure clusters, costs, diagnosis review)
- ⬜ Phase 5 — Hardening (rate limits, audit log, alerting, tenant isolation tests)

## Local setup

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply `supabase/migrations/20260727000000_init.sql` in the SQL editor.
3. Optional: enable the Google provider (Authentication → Providers → Google).
4. Copy the project URL, anon key, and service-role key into `.env.local`.

### 2. Run

```bash
cp .env.example .env.local   # fill in the values above
npm install
npm run dev                  # http://localhost:3000
```

### 3. End-to-end verification

1. Sign up at `/login` (org auto-provisioned on signup).
2. Dashboard → **API keys** → create a key (shown once).
3. Send a run with the curl snippet on the keys page.
4. The run appears on the dashboard immediately.

## Ingest API

`POST /api/ingest`

- **Auth**: `Authorization: Bearer al_sk_...` — keys are stored as sha256
  hashes and revocable from the dashboard.
- **Idempotency**: required `Idempotency-Key` header, unique per org.
  Duplicates are acknowledged without reprocessing; failed requests are
  retried safely with the same key.
- **Payload**: up to 100 runs per batch, each with up to 500 ordered trace
  events (`llm_call` / `tool_call` / `error` / `log` / `custom`), fully
  zod-validated (422 on schema violations).
- **Lifecycle**: `running → completed | failed | timeout | canceled` — a
  terminal run never regresses to `running`; replayed event sequence numbers
  are ignored.

## Tests

```bash
npm test   # ingest integration tests: auth, validation, idempotency,
           # retry-after-failure, lifecycle non-regression
```

## Architecture notes

- **Multi-tenancy:** RLS on every table via `public.current_org_id()`; the
  ingest path runs with the service role and resolves the tenant from the
  API key's org.
- **Guest mode:** while Supabase env is absent, "Continue as guest" previews
  the dashboard; it self-disables the moment real keys are configured.
- **Costs:** stored as integer micro-USD to avoid float drift.
