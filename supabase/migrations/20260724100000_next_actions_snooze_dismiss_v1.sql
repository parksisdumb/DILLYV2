-- next_actions_snooze_dismiss_v1
--
-- Overdue handling for the follow-up queue. The cadence engine now auto-schedules
-- a next_action on every logged outcome across all surfaces, so the Advance queue
-- grows from ~1 item to dozens per rep. Snooze/roll-forward + dismiss-with-reason
-- keep overdue items from rotting, and a chronic-snooze signal surfaces dead leads
-- or avoidance to managers.
--
--   * snoozed_count    — times this action has been rescheduled. 3+ is "chronic".
--   * last_snoozed_at   — when it was last rescheduled (who = assigned_user_id).
--   * dismiss_reason    — why an action was closed without completing it. Paired
--                         with status = 'dismissed' (status has no CHECK, so the
--                         new value needs no constraint change).
--
-- Reps already have UPDATE on their own next_actions (managers read all), so snooze
-- and dismiss need no new RLS.
--
-- NOTE: must be applied to prod manually (prod `db push` is blocked for the local
-- CLI account). Idempotent — safe to re-run.

begin;

alter table if exists public.next_actions
  add column if not exists snoozed_count integer not null default 0,
  add column if not exists last_snoozed_at timestamptz,
  add column if not exists dismiss_reason text;

-- Managers filter chronic-snooze + dismissed items; partial index keeps it cheap.
create index if not exists next_actions_chronic_snooze_idx
  on public.next_actions (org_id, assigned_user_id)
  where snoozed_count >= 3;

commit;
