-- Widen agent_runs.run_type to support split agent architecture
alter table agent_runs drop constraint if exists agent_runs_run_type_check;
alter table agent_runs add constraint agent_runs_run_type_check
  check (run_type in ('prospecting', 'distribution', 'edgar_intelligence', 'prospect_discovery'));
