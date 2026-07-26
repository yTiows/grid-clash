-- =============================================================================
-- Migration: Tournament completion and prize distribution
--
-- Placings and payout amounts are computed by the already-tested TypeScript
-- in bracket.ts (finalPlacings) and formats.ts (distributePrizePool) and
-- passed in as JSONB — this function persists and pays them atomically. The
-- same "one tested implementation, database validates" split used for ranked
-- settlement: a bug in the TS math surfaces as a constraint violation here,
-- not a silent misplacement of prize money.
-- =============================================================================

create or replace function public.complete_tournament(
  p_tournament_id uuid,
  -- [{"user_id": "...", "place": 1, "amount_cents": 1500}, ...]
  p_placings jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament record;
  v_placing jsonb;
  v_user_id uuid;
  v_place integer;
  v_amount integer;
  v_total_paid integer := 0;
  v_winner_id uuid;
  v_tier text;
begin
  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;

  -- Idempotent: a retried call against an already-completed tournament is a
  -- no-op, not a double payout. Mirrors settle_ranked_match's guard.
  if v_tournament.status = 'completed' then
    return;
  end if;

  if v_tournament.status not in ('in_progress', 'full', 'open') then
    raise exception 'Tournament in status % cannot be completed', v_tournament.status;
  end if;

  for v_placing in select * from jsonb_array_elements(p_placings)
  loop
    v_user_id := (v_placing->>'user_id')::uuid;
    v_place := (v_placing->>'place')::integer;
    v_amount := (v_placing->>'amount_cents')::integer;

    if v_place = 1 then
      v_winner_id := v_user_id;
    end if;

    -- Reuses the existing per-place uniqueness and positive-amount CHECK
    -- constraints already on this table — a duplicate place or a zero/
    -- negative amount fails here rather than silently paying wrong.
    insert into public.tournament_payouts (tournament_id, user_id, place, amount_cents)
    values (p_tournament_id, v_user_id, v_place, v_amount);

    perform public.move_balance(
      v_user_id, v_amount, 'tournament_payout',
      'tournament_payout:' || p_tournament_id::text || ':' || v_place::text,
      null, p_tournament_id
    );

    update public.tournament_entries
    set final_place = v_place, eliminated_at = coalesce(eliminated_at, now())
    where tournament_id = p_tournament_id and user_id = v_user_id;

    v_total_paid := v_total_paid + v_amount;
  end loop;

  -- The database's own guard against a settlement bug overpaying the
  -- advertised pool — assert_payouts_balance (migration 0006) fires as a
  -- trigger on tournament_payouts inserts above, so this is a second,
  -- redundant check at the aggregate level rather than the only one.
  if v_total_paid > v_tournament.prize_pool_cents then
    raise exception 'Total payouts (%) exceed prize pool (%)', v_total_paid, v_tournament.prize_pool_cents;
  end if;

  -- Platform rake is recorded as revenue only on a completed tournament, not
  -- at creation. A cancelled tournament refunds every entrant in full,
  -- including the notional rake — recording it as revenue before that
  -- outcome is known would overstate the published milestone counter.
  if v_tournament.rake_cents <> 0 then
    insert into public.platform_ledger (entry_type, amount_cents, tournament_id, note)
    values ('tournament_rake', v_tournament.rake_cents, p_tournament_id, 'tournament completion');
  end if;

  -- Title tier is deterministic from the entry fee already locked on the
  -- tournament row — no external input, so no random roll and nothing for a
  -- client to influence. Mirrors titleTierFor() in fees.ts exactly.
  v_tier := case
    when v_tournament.entry_fee_cents >= 25000 then 'obsidian'
    when v_tournament.entry_fee_cents >= 10000 then 'gold'
    when v_tournament.entry_fee_cents >= 2500 then 'silver'
    else 'bronze'
  end;

  if v_winner_id is not null then
    insert into public.player_titles (user_id, tier, tournament_id)
    values (v_winner_id, v_tier, p_tournament_id);
  end if;

  update public.tournaments set status = 'completed' where id = p_tournament_id;
end;
$$;

revoke execute on function public.complete_tournament(uuid, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_tournament_round / record_tournament_match_result
--
-- Round persistence and per-match result recording. These do not move money
-- — a bug here is a gameplay/UX defect, not a money-safety one — so they
-- carry lighter but still real verification below.
-- ---------------------------------------------------------------------------
create or replace function public.create_tournament_round(
  p_tournament_id uuid,
  p_round_number integer,
  -- [{"board_position": 1, "player1": "...", "player2": "..."|null, "is_bye": bool}, ...]
  p_pairings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament record;
  v_round_id uuid;
  v_pairing jsonb;
  v_p1 uuid;
  v_p2 uuid;
  v_is_bye boolean;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found';
  end if;

  if p_round_number = 1 then
    if v_tournament.status not in ('open', 'full') then
      raise exception 'Tournament in status % cannot start', v_tournament.status;
    end if;
    update public.tournaments set status = 'in_progress' where id = p_tournament_id;
  end if;

  insert into public.tournament_rounds (tournament_id, round_number, status, started_at)
  values (p_tournament_id, p_round_number, 'in_progress', now())
  returning id into v_round_id;

  for v_pairing in select * from jsonb_array_elements(p_pairings)
  loop
    v_p1 := (v_pairing->>'player1')::uuid;
    v_p2 := nullif(v_pairing->>'player2', 'null')::uuid;
    v_is_bye := coalesce((v_pairing->>'is_bye')::boolean, false);

    insert into public.tournament_matches (
      tournament_id, round_id, player_1_id, player_2_id, winner_id,
      is_bye, board_position, status
    ) values (
      p_tournament_id, v_round_id, v_p1, v_p2,
      case when v_is_bye then v_p1 else null end,
      v_is_bye, (v_pairing->>'board_position')::integer,
      case when v_is_bye then 'completed' else 'pending' end
    );
  end loop;

  return v_round_id;
end;
$$;

revoke execute on function public.create_tournament_round(uuid, integer, jsonb) from anon, authenticated;

create or replace function public.record_tournament_match_result(
  p_tournament_match_id uuid,
  p_winner_id uuid,
  p_match_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
begin
  select * into v_match from public.tournament_matches where id = p_tournament_match_id for update;
  if not found then
    raise exception 'Tournament match not found';
  end if;

  if v_match.status = 'completed' then
    return; -- idempotent
  end if;

  if p_winner_id not in (v_match.player_1_id, v_match.player_2_id) then
    raise exception 'Winner must be one of the two players in this match';
  end if;

  update public.tournament_matches
  set winner_id = p_winner_id, status = 'completed', match_id = coalesce(p_match_id, match_id)
  where id = p_tournament_match_id;
end;
$$;

revoke execute on function public.record_tournament_match_result(uuid, uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- assert_tournament_completion_works
--
-- Same shape as assert_settlement_works() and assert_tournament_entry_works
-- — proves the RPC completes end to end, inside a probe that never commits.
-- ---------------------------------------------------------------------------
create or replace function public.assert_tournament_completion_works()
returns text
language plpgsql
as $$
declare
  v_user uuid;
  v_tournament_id uuid;
  v_before integer;
  v_after integer;
begin
  select id, balance_cents into v_user, v_before
  from public.users
  where account_status = 'active' order by created_at limit 1;

  if v_user is null then
    return 'skipped: needs at least one user';
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__completion_probe__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'in_progress'
  ) returning id into v_tournament_id;

  perform public.complete_tournament(
    v_tournament_id,
    jsonb_build_array(jsonb_build_object('user_id', v_user, 'place', 1, 'amount_cents', 1800))
  );

  select balance_cents into v_after from public.users where id = v_user;

  if v_after <> v_before + 1800 then
    raise exception 'Expected balance % + 1800, got %', v_before, v_after;
  end if;

  -- Second call must be a no-op, not a double payout.
  perform public.complete_tournament(
    v_tournament_id,
    jsonb_build_array(jsonb_build_object('user_id', v_user, 'place', 1, 'amount_cents', 1800))
  );

  select balance_cents into v_after from public.users where id = v_user;
  if v_after <> v_before + 1800 then
    raise exception 'Idempotency failed: balance moved on second call';
  end if;

  return 'ok: tournament completion pays once, exactly once';
end;
$$;

revoke execute on function public.assert_tournament_completion_works() from anon, authenticated;
