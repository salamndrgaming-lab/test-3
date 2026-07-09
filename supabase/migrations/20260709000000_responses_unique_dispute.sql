-- One canonical response row per dispute (regenerations upsert in place),
-- required for `on conflict (dispute_id)` upserts from the response engine.
alter table responses
  add constraint responses_dispute_id_unique unique (dispute_id);
