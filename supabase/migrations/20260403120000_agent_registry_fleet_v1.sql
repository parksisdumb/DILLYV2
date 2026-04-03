-- Seed all agent fleet entries into agent_registry

begin;

insert into agent_registry (agent_name, display_name, schedule, enabled, config) values
  ('car-dealership-agent', 'Car Dealership Discovery', '0 8 3 * *', false, '{}'::jsonb),
  ('self-storage-agent', 'Self-Storage Facility Discovery', '0 9 3 * *', false, '{}'::jsonb),
  ('public-bid-agent', 'Public Bid Monitor', '0 10 * * 1', false, '{}'::jsonb),
  ('corporate-campus-agent', 'Corporate Campus Discovery', '0 11 4 * *', false, '{}'::jsonb),
  ('private-reit-agent', 'Private REIT Discovery', '0 12 4 * *', false, '{}'::jsonb)
on conflict (agent_name) do nothing;

commit;
