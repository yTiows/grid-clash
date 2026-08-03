-- =============================================================================
-- Migration: self-test for record_tournament_match_result's match_id contract
--
-- No SQL logic changed here — record_tournament_match_result() itself was
-- always correct; the bug was entirely on the TypeScript side.
-- src/server/sql-match-store.ts's recordTournamentResult() was passing a
-- freshly-generated randomUUID() (match-server.ts's in-memory match.id) as
-- p_match_id on every real tournament match completion. No public.matches
-- row is ever created for a tournament match, so this violated
-- tournament_matches_match_id_fkey every single time — confirmed live via a
-- rolled-back probe (2026-08-01): NO tournament match has ever been able to
-- complete through real gameplay (the WS server's actual settle() path);
-- only the admin manual-completion path (which never calls this function)
-- has ever worked. Fixed by passing null instead — match_id is nullable by
-- design specifically for this case.
--
-- This migration pins the contract the fix now depends on: null always
-- succeeds, a match_id that doesn't exist in public.matches always fails
-- with the FK violation (so a future change can't silently reintroduce the
-- bug by making the null case start requiring a real value again without
-- this test catching it).
-- =============================================================================

create or replace function public.assert_tournament_match_result_match_id_contract()
returns text
language plpgsql
as $$
declare
  v_p1 uuid;
  v_p2 uuid;
  v_tournament_id uuid;
  v_round_id uuid;
  v_tm_id uuid;
  v_fk_violation_raised boolean := false;
  v_status text;
begin
  select id into v_p1 from public.users order by created_at limit 1;
  select id into v_p2 from public.users where id <> v_p1 order by created_at limit 1;
  if v_p1 is null or v_p2 is null then
    return 'skipped: needs two distinct users';
  end if;

  begin
    insert into public.tournaments (
      kind, name, entry_fee_cents, field_size, rake_bps,
      gross_cents, rake_cents, prize_pool_cents,
      format_id, ruleset_id, rounds, status
    ) values (
      'tournament_standard', '__match_id_contract_probe__', 500, 4, 1400,
      2000, 280, 1720,
      'single_elimination', 'classic', 2, 'open'
    ) returning id into v_tournament_id;

    insert into public.tournament_rounds (tournament_id, round_number, status)
    values (v_tournament_id, 1, 'in_progress')
    returning id into v_round_id;

    insert into public.tournament_matches (tournament_id, round_id, player_1_id, player_2_id, board_position, status)
    values (v_tournament_id, v_round_id, v_p1, v_p2, 1, 'in_progress')
    returning id into v_tm_id;

    -- The real fix: null must succeed and mark the match completed. This is
    -- exactly what src/server/sql-match-store.ts's recordTournamentResult()
    -- now does on every real tournament match.
    perform public.record_tournament_match_result(v_tm_id, v_p1, null);

    select status into v_status from public.tournament_matches where id = v_tm_id;
    if v_status <> 'completed' then
      raise exception 'Expected tournament_matches.status = completed after a null match_id result, got %', v_status;
    end if;

    -- The failure mode that was actually happening in production: a
    -- match_id that doesn't correspond to a real public.matches row must
    -- still be rejected by the FK constraint, on a second, fresh match so
    -- the already-completed row above doesn't mask this with its own
    -- idempotent early-return.
    insert into public.tournament_matches (tournament_id, round_id, player_1_id, player_2_id, board_position, status)
    values (v_tournament_id, v_round_id, v_p1, v_p2, 2, 'in_progress')
    returning id into v_tm_id;

    begin
      perform public.record_tournament_match_result(v_tm_id, v_p1, gen_random_uuid());
    exception when foreign_key_violation then
      v_fk_violation_raised := true;
    end;
    if not v_fk_violation_raised then
      raise exception 'Expected a nonexistent match_id to be rejected by tournament_matches_match_id_fkey';
    end if;
  exception when others then
    delete from public.tournament_matches where tournament_id = v_tournament_id;
    delete from public.tournament_rounds where tournament_id = v_tournament_id;
    delete from public.tournaments where id = v_tournament_id;
    raise;
  end;

  delete from public.tournament_matches where tournament_id = v_tournament_id;
  delete from public.tournament_rounds where tournament_id = v_tournament_id;
  delete from public.tournaments where id = v_tournament_id;

  return 'ok: record_tournament_match_result succeeds with match_id = null (the real fix) and still rejects a match_id with no backing matches row';
end;
$$;

revoke execute on function public.assert_tournament_match_result_match_id_contract() from anon, authenticated;

select public.assert_tournament_match_result_match_id_contract();
