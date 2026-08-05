-- Self-test for Feature B's write path, following this codebase's own
-- assert_* convention (assert_settlement_works et al.): checks the
-- permission boundary unconditionally (needs no data), and honestly skips
-- the insert-path check with a named reason when matches is empty — true on
-- this project pre-launch (no ranked match has ever settled here yet).

create or replace function public.assert_performance_snapshot_recording_works()
returns text
language plpgsql
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
  -- Idempotency: a second identical call must not double-insert.
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
