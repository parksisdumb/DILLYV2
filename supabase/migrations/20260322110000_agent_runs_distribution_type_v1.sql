-- Allow 'distribution' as a valid run_type in agent_runs
alter table agent_runs drop constraint if exists agent_runs_run_type_check;
alter table agent_runs add constraint agent_runs_run_type_check
  check (run_type in ('prospecting', 'distribution'));
