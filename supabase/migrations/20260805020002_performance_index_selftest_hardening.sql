-- Fixes two gaps the Supabase security advisor caught immediately after
-- 20260805020000/20260805020001 were applied live: both new self-test
-- functions had a mutable search_path (WARN-level linter finding — this
-- codebase's database-linter conventions require `set search_path = public`
-- on every function, which record_performance_snapshot already had but
-- these two did not), and assert_performance_index_snapshots_excludes_financial_columns
-- was never revoked from anon/authenticated, unlike every other assert_*
-- function in this codebase (e.g. assert_settlement_works). Neither
-- function exposes sensitive data even when callable — this closes the
-- gap between these two and the project's own established pattern, caught
-- by actually running the advisor, not by re-reading the migration.

create or replace function public.assert_performance_index_snapshots_excludes_financial_columns()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_leaked text;
begin
  select string_agg(column_name, ', ') into v_leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('performance_index_snapshots')
    and (
      column_name ~* 'stake|fee|payout|balance|wallet|deposit|withdraw|rake|price|cost|revenue'
    );

  if v_leaked is not null then
    raise exception 'performance_index_snapshots has financial-looking column(s): %. Feature B''s gameplay-only invariant is violated.', v_leaked;
  end if;

  select string_agg(column_name, ', ') into v_leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'player_standing'
    and column_name like 'pi_%'
    and column_name ~* 'stake|fee|payout|balance|wallet|deposit|withdraw|rake|price|cost|revenue';

  if v_leaked is not null then
    raise exception 'player_standing has financial-looking Performance Index column(s): %.', v_leaked;
  end if;

  return 'ok: performance_index_snapshots and player_standing.pi_* carry no financial columns';
end;
$$;

revoke execute on function public.assert_performance_index_snapshots_excludes_financial_columns() from anon, authenticated;

create or replace function public.assert_performance_snapshot_recording_works()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_match uuid;
  v_user uuid;
  v_count integer;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
begin
  select has_function_privilege('anon', 'public.record_performance_snapshot(uuid,uuid,text,integer,boolean,integer,integer,integer,integer,integer,integer,integer,integer)', 'execute')
    into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.record_performance_snapshot(uuid,uuid,text,integer,boolean,integer,integer,integer,integer,integer,integer,integer,integer)', 'execute')
    into v_authenticated_can_execute;

  if v_anon_can_execute or v_authenticated_can_execute then
    raise exception 'record_performance_snapshot is callable by anon(%) or authenticated(%) — must be service-role only', v_anon_can_execute, v_authenticated_can_execute;
  end if;

  select id into v_match from public.matches order by created_at limit 1;
  select id into v_user from public.users order by created_at limit 1;

  if v_match is null or v_user is null then
    return 'skipped: needs at least one row in matches (none exist yet — pre-launch, no ranked match has settled on this project). Permission-boundary check above ran and passed regardless.';
  end if;

  perform public.record_performance_snapshot(
    v_match, v_user, 'classic', 12, true,
    100, 35, 40, 40, 15, 25, 10, 35
  );
  perform public.record_performance_snapshot(
    v_match, v_user, 'classic', 12, true,
    100, 35, 40, 40, 15, 25, 10, 35
  );

  select count(*) into v_count from public.performance_index_snapshots
    where match_id = v_match and user_id = v_user;

  if v_count <> 1 then
    raise exception 'expected exactly 1 snapshot row after two identical calls, got %', v_count;
  end if;

  delete from public.performance_index_snapshots where match_id = v_match and user_id = v_user;

  return 'ok: record_performance_snapshot is idempotent and permission boundary holds';
end;
$$;

revoke execute on function public.assert_performance_snapshot_recording_works() from anon, authenticated;
