-- Seed CMS Healthcare agent into agent_registry

insert into agent_registry (agent_name, display_name, schedule, enabled, config) values
  ('cms_healthcare', 'CMS Healthcare Facilities', '0 3 1 * *', true,
   '{"last_offset": 0, "batch_size": 5000}'::jsonb)
on conflict (agent_name) do nothing;
