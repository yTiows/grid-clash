-- =============================================================================
-- Migration: satellite completion pays seats, not a descending cash curve
--
-- FOUND BY: reading sql-match-store.ts's payoutTournament() and
-- admin-tournaments.ts's completeTournamentAction() against formats.ts.
-- Both call distributePrizePool(), which applies the same field-size-based
-- descending PAYOUT_CURVES to every format — including 'satellite'. A
-- satellite is defined by paying every qualifier the SAME ticket value, not
-- a winner-takes-most curve; that is the entire mechanic (see
-- planSatellite() in formats.ts, already correct but never called from
-- either completion path). Confirmed separately: tournaments.
-- satellite_target_tournament_id/satellite_seat_value_cents were never set by
-- createTournamentAction either, so a satellite could not even be created
-- through the admin UI — the format was inoperable end to end, not just
-- mispaid.
--
-- FIX: a dedicated completion function. Seats are non-transferable
-- satellite_seats rows (already the correct table, already used by
-- enter_tournament to redeem a won seat) awarded to the top N finishers,
-- where N = floor(prize pool / target entry fee) — the same arithmetic
-- planSatellite() already computes in TypeScript. Any remainder pays cash to
-- the next finisher, never retained. Idempotent and rake-recorded the same
-- way complete_tournament() is.
-- =============================================================================

create or replace function public.complete_satellite_tournament(
  p_tournament_id uuid,
  -- [{"user_id": "...", "place": 1}, ...] — top N finishers who win a seat.
  p_seat_winners jsonb,
  -- {"user_id": "...", "place": N+1, "amount_cents": ...} or null — the
  -- bubble finisher paid the pool's remainder in cash, when there is one.
  p_bubble jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament record;
  v_target record;
  v_placing jsonb;
  v_user_id uuid;
  v_place integer;
  v_winner_id uuid;
  v_tier text;
  v_bubble_user uuid;
  v_bubble_place integer;
  v_bubble_amount integer;
  v_total_paid integer := 0;
begin
  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;

  if v_tournament.format_id <> 'satellite' then
    raise exception 'complete_satellite_tournament called on a % tournament', v_tournament.format_id;
  end if;
  if v_tournament.satellite_target_tournament_id is null then
    raise exception 'Satellite has no target tournament configured';
  end if;

  -- Idempotent, same shape as complete_tournament: a retried call against an
  -- already-completed contest is a no-op, not a double award.
  if v_tournament.status = 'completed' then
    return;
  end if;

  if v_tournament.status not in ('in_progress', 'full', 'open') then
    raise exception 'Tournament in status % cannot be completed', v_tournament.status;
  end if;

  select entry_fee_cents into v_target
  from public.tournaments where id = v_tournament.satellite_target_tournament_id;
  if not found then
    raise exception 'Satellite target tournament no longer exists';
  end if;

  for v_placing in select * from jsonb_array_elements(p_seat_winners)
  loop
    v_user_id := (v_placing->>'user_id')::uuid;
    v_place := (v_placing->>'place')::integer;

    if v_place = 1 then
      v_winner_id := v_user_id;
    end if;

    insert into public.satellite_seats (
      won_in_tournament_id, target_tournament_id, user_id, seat_value_cents, status
    ) values (
      p_tournament_id, v_tournament.satellite_target_tournament_id, v_user_id,
      v_tournament.satellite_seat_value_cents, 'unredeemed'
    );

    update public.tournament_entries
    set final_place = v_place, eliminated_at = coalesce(eliminated_at, now())
    where tournament_id = p_tournament_id and user_id = v_user_id;

    v_total_paid := v_total_paid + v_tournament.satellite_seat_value_cents;
  end loop;

  if p_bubble is not null then
    v_bubble_user := (p_bubble->>'user_id')::uuid;
    v_bubble_place := (p_bubble->>'place')::integer;
    v_bubble_amount := (p_bubble->>'amount_cents')::integer;

    if v_bubble_amount > 0 then
      -- Reuses tournament_payouts and its assert_payouts_balance trigger —
      -- the bubble is real cash, so it goes through the same audited path
      -- ordinary place money does.
      insert into public.tournament_payouts (tournament_id, user_id, place, amount_cents)
      values (p_tournament_id, v_bubble_user, v_bubble_place, v_bubble_amount);

      perform public.move_balance(
        v_bubble_user, v_bubble_amount, 'tournament_payout',
        'tournament_payout:' || p_tournament_id::text || ':' || v_bubble_place::text,
        null, p_tournament_id
      );

      update public.tournament_entries
      set final_place = v_bubble_place, eliminated_at = coalesce(eliminated_at, now())
      where tournament_id = p_tournament_id and user_id = v_bubble_user;

      v_total_paid := v_total_paid + v_bubble_amount;
    end if;
  end if;

  if v_total_paid > v_tournament.prize_pool_cents then
    raise exception 'Total satellite payout (%) exceeds prize pool (%)', v_total_paid, v_tournament.prize_pool_cents;
  end if;

  if v_tournament.rake_cents <> 0 then
    insert into public.platform_ledger (entry_type, amount_cents, tournament_id, note)
    values ('tournament_rake', v_tournament.rake_cents, p_tournament_id, 'satellite completion');
  end if;

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

revoke execute on function public.complete_satellite_tournament(uuid, jsonb, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- assert_satellite_completion_works
-- Same shape as assert_tournament_completion_works(): a real end-to-end
-- probe, executed against a live database and left in place for CI / manual
-- re-runs against a disposable project.
-- ---------------------------------------------------------------------------
create or replace function public.assert_satellite_completion_works()
returns text
language plpgsql
as $$
declare
  v_user uuid;
  v_target_id uuid;
  v_sat_id uuid;
  v_before integer;
  v_after integer;
  v_seat_count integer;
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
    'tournament_standard', '__satellite_target_probe__', 5000, 8, 1000,
    40000, 4000, 36000,
    'single_elimination', 'classic', 3, 'open'
  ) returning id into v_target_id;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status,
    satellite_target_tournament_id, satellite_seat_value_cents
  ) values (
    'tournament_standard', '__satellite_probe__', 500, 16, 1000,
    8000, 800, 7200,
    'satellite', 'classic', 4, 'in_progress',
    v_target_id, 5000
  ) returning id into v_sat_id;

  -- 7200 pool / 5000 target buy-in = 1 seat, 2200 bubble cash.
  perform public.complete_satellite_tournament(
    v_sat_id,
    jsonb_build_array(jsonb_build_object('user_id', v_user, 'place', 1)),
    jsonb_build_object('user_id', v_user, 'place', 2, 'amount_cents', 2200)
  );

  select balance_cents into v_after from public.users where id = v_user;
  if v_after <> v_before + 2200 then
    raise exception 'Expected bubble cash %, got balance %', v_before + 2200, v_after;
  end if;

  select count(*) into v_seat_count from public.satellite_seats
  where user_id = v_user and won_in_tournament_id = v_sat_id and status = 'unredeemed';
  if v_seat_count <> 1 then
    raise exception 'Expected exactly one unredeemed seat, found %', v_seat_count;
  end if;

  -- Idempotency: second call must not award a second seat or pay twice.
  perform public.complete_satellite_tournament(
    v_sat_id,
    jsonb_build_array(jsonb_build_object('user_id', v_user, 'place', 1)),
    jsonb_build_object('user_id', v_user, 'place', 2, 'amount_cents', 2200)
  );

  select balance_cents into v_after from public.users where id = v_user;
  if v_after <> v_before + 2200 then
    raise exception 'Idempotency failed: balance moved on second call';
  end if;

  select count(*) into v_seat_count from public.satellite_seats
  where user_id = v_user and won_in_tournament_id = v_sat_id;
  if v_seat_count <> 1 then
    raise exception 'Idempotency failed: seat count is %, not 1', v_seat_count;
  end if;

  return 'ok: satellite completion awards seats and pays bubble cash, exactly once';
end;
$$;

revoke execute on function public.assert_satellite_completion_works() from anon, authenticated;
