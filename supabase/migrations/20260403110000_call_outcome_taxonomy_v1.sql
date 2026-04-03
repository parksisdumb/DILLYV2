-- Expanded call outcome taxonomy for coaching data

begin;

-- Add key column if missing
alter table touchpoint_outcomes add column if not exists key text;

-- Drop existing partial index if it exists (may not be unique)
drop index if exists touchpoint_outcomes_key_idx;

-- Add a proper unique constraint
alter table touchpoint_outcomes
  add constraint touchpoint_outcomes_key_unique unique (key);

-- Insert new outcomes (skip if key exists)
insert into touchpoint_outcomes (key, name, sort_order) values
  ('connected_conversation', 'Connected — had a conversation', 10),
  ('no_answer_voicemail', 'No Answer — left voicemail', 20),
  ('no_answer_no_voicemail', 'No Answer — no voicemail', 25),
  ('gatekeeper', 'Gatekeeper — couldn''t get through', 30),
  ('not_interested', 'Not Interested', 35),
  ('callback_requested', 'Call Back Later', 38),
  ('inspection_scheduled', 'Scheduled — booked inspection', 40),
  ('bid_submitted', 'Bid Submitted', 50),
  ('won', 'Won', 60),
  ('lost', 'Lost', 70),
  ('email_sent', 'Sent', 80),
  ('email_replied', 'Got a Reply', 82),
  ('email_bounced', 'Bounced', 84),
  ('met_in_person', 'Met in Person', 90),
  ('not_available', 'Not There', 92)
on conflict (key) do update set
  name = excluded.name,
  sort_order = excluded.sort_order;

commit;
