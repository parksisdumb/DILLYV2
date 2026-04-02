-- Seed enrichment agent into agent_registry

insert into agent_registry (agent_name, display_name, schedule, enabled, config) values
  ('enrichment', 'Contact Enrichment', '0 */6 * * *', true,
   '{"batch_size": 50}'::jsonb)
on conflict (agent_name) do nothing;

-- Also widen agent_runs.run_type to include 'enrichment'
alter table agent_runs drop constraint if exists agent_runs_run_type_check;
