-- Per-reason-code auto-submit: when a dispute's reason is in this list and
-- the AI response passes QA + validation, it is submitted to Stripe without
-- waiting for human review.
alter table organizations
  add column auto_submit_reasons text[] not null default '{}';
