# RecoveryEngine

AI-powered chargeback dispute response platform for mid-market e-commerce.
Businesses connect their Stripe account; when a chargeback hits, RecoveryEngine
assembles evidence and generates a winning dispute response. Pricing is
success-based (% of recovered revenue).

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Supabase (auth + Postgres + RLS) · Stripe Connect · Anthropic API · Tailwind + shadcn/ui · Vercel

## Status

- ✅ **Phase 1 — Foundation**: auth (email + Google), Stripe Connect onboarding,
  full DB schema with dispute lifecycle, verified + idempotent dispute webhooks
- ✅ **Phase 2 — Evidence Engine**: reason-code → evidence weighting config with
  Visa/Mastercard citations, Stripe evidence collector, normalized bundles with
  gap detection, daily sweep cron
- ✅ **Phase 3 — AI Response Engine**: two-pass drafting (Claude Opus 4.8) with
  adversarial QA and programmatic no-fabrication validation
- ⬜ Phase 4 — Dashboard
- ⬜ Phase 5 — Hardening

## Local setup

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply the schema: paste `supabase/migrations/20260706000000_init.sql` into the
   SQL editor (or `supabase db push` with the CLI).
3. **Google auth**: Authentication → Providers → Google → enable, using OAuth
   credentials from Google Cloud Console (authorized redirect URI:
   `https://YOUR-PROJECT.supabase.co/auth/v1/callback`). Email/password works
   out of the box.
4. Copy the project URL, anon key, and service-role key into `.env.local`.

### 2. Stripe

1. In test mode, enable Connect (Dashboard → Connect).
2. Settings → Connect → Onboarding options → OAuth: enable OAuth for standard
   accounts, add redirect URI `http://localhost:3000/api/stripe/connect/callback`,
   and copy the client id (`ca_...`).
3. Developers → Webhooks → Add endpoint:
   - URL: `https://YOUR-DOMAIN/api/webhooks/stripe` (locally: `stripe listen
     --forward-to localhost:3000/api/webhooks/stripe`)
   - **Listen on: connected accounts** (Connect webhook, not account webhook)
   - Events: `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`
   - Copy the signing secret (`whsec_...`).

### 3. Run

```bash
cp .env.example .env.local   # fill in the values above
npm install
npm run dev                  # http://localhost:3000
```

### 4. End-to-end verification (test mode)

1. Sign up at `/login` (org is auto-provisioned on signup).
2. Dashboard → **Connect Stripe** → authorize a test-mode account. The app
   verifies dispute read access before marking the account verified.
3. Trigger a test dispute on the connected account: create a charge with card
   `4000 0000 0000 0259` (creates a dispute automatically), or
   `stripe trigger charge.dispute.created --stripe-account acct_...`.
4. The dispute appears on the dashboard in status `new`.

## Tests

```bash
npm test          # webhook integration tests (signature verification,
                  # idempotency, lifecycle transitions, outcome + fee math)
```

## Architecture notes

- **Dispute lifecycle:** `new → evidence_gathering → drafted → submitted → won/lost`
  (Postgres enum `dispute_status`). Stripe's own status is stored separately in
  `disputes.stripe_status`; `charge.dispute.updated` never regresses our
  pipeline status.
- **Webhook idempotency:** every Stripe event id is claimed in `webhook_events`
  (unique index). Duplicates are acknowledged and skipped; failed processing
  returns 500 so Stripe retries, and retries are reprocessed.
- **Multi-tenancy:** RLS on every table; users only see rows for their org
  (`public.current_org_id()`). Webhooks run with the service role and resolve
  the tenant from the connected account id.
- **Success fee:** calculation only for now — recorded on won outcomes at the
  org's `fee_rate` (default 15%), no payment collection yet.
- **AI response engine (two-pass):** a drafting pass produces the narrative +
  a mapping onto Stripe's dispute evidence object (structured outputs via
  `messages.parse`); an adversarial QA pass critiques it as the issuing bank's
  reviewer. A programmatic validator independently checks every submitted
  value and every identifier in the narrative against the evidence bundle —
  fabricated evidence can never pass, even if QA misses it. Lifecycle
  auto-advances to `drafted` only when validation AND QA pass; otherwise the
  response is stored with `needs_human_review` for the dashboard.
- **Pipeline:** webhook ack → `after()` → gather evidence → draft + QA; the
  daily sweep cron retries disputes stuck in `new` (no evidence) or
  `evidence_gathering` (no response — e.g. `ANTHROPIC_API_KEY` was absent).
