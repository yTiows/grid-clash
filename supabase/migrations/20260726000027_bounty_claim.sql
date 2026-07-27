-- =============================================================================
-- Migration: bounty claiming — the missing money path in the bounty format
--
-- FOUND BY: reading enter_tournament() (which posts a tournament_bounties row
-- per entrant when bounty_per_head_cents > 0) forward to see where a bounty
-- ever gets claimed and paid. Nothing does. tournament_bounties.
-- claimed_by_user_id/claimed_at/claimed_in_match_id exist specifically to
-- record a claim, assert_bounty_pool_balance (migration 7) guards the pool,
-- but no function anywhere sets those columns or calls move_balance with
-- reason 'bounty_claim' — a reason code the ledger vocabulary (migration 8)
-- already added in anticipation of exactly this.
--
-- IMPACT: bounty_pool_cents is carved out of every bounty tournament's prize
-- pool at creation (place_pool_cents = prize_pool_cents - bounty_pool_cents),
-- so that money is real and already deducted from what place finishers can
-- win — but with no claim path, it can never reach any player. It is not
-- rake either (never recorded as tournament_rake); it simply has nowhere to
-- go. This is a straightforward gap, not a subtle one: the bounty format
-- could not have paid a single bounty since it was introduced.
--
-- FIX: record_tournament_match_result claims the loser's bounty for the
-- winner, but only for bounty-format tournaments and only for a real
-- decisive result (never a bye, which this function is never called for —
-- byes are recorded directly by create_tournament_round). The existing
-- unique constraint on (tournament_id, head_user_id) plus the
-- claimed_by_user_id IS NULL check make a double-claim structurally
-- impossible, the same idempotency-by-construction pattern as every other
-- money path in this schema.
-- =============================================================================

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
  v_loser_id uuid;
  v_tournament record;
  v_bounty record;
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

  -- Bounty claim. Only for the bounty format, only on a real decisive
  -- result (a bye has no loser and never reaches this function), and only
  -- if the loser was actually carrying an unclaimed bounty — a linked-
  -- account sockpuppet cannot both dodge the tournament_bounties insert
  -- (posted unconditionally by enter_tournament) and still deny a real
  -- opponent the claim.
  select * into v_tournament from public.tournaments where id = v_match.tournament_id;
  if v_tournament.format_id = 'bounty' then
    v_loser_id := case when p_winner_id = v_match.player_1_id then v_match.player_2_id else v_match.player_1_id end;

    if v_loser_id is not null then
      select * into v_bounty
      from public.tournament_bounties
      where tournament_id = v_match.tournament_id
        and head_user_id = v_loser_id
        and claimed_by_user_id is null
      for update;

      if found then
        update public.tournament_bounties
        set claimed_by_user_id = p_winner_id,
            claimed_at = now(),
            claimed_in_match_id = p_match_id
        where id = v_bounty.id;

        perform public.move_balance(
          p_winner_id, v_bounty.amount_cents, 'bounty_claim',
          'bounty_claim:' || v_bounty.id::text,
          p_match_id, v_match.tournament_id
        );
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.record_tournament_match_result(uuid, uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- assert_bounty_claim_works
-- Real end-to-end probe: two entrants in a bounty tournament, one eliminates
-- the other, confirms the bounty actually lands in the winner's balance and
-- cannot be claimed twice.
-- ---------------------------------------------------------------------------
create or replace function public.assert_bounty_claim_works()
returns text
language plpgsql
as $$
declare
  v_winner uuid;
  v_loser uuid;
  v_tournament_id uuid;
  v_round_id uuid;
  v_tm_id uuid;
  v_before integer;
  v_after integer;
  v_bounty_id uuid;
begin
  select id into v_winner from public.users u
    where u.account_status = 'active' order by u.created_at limit 1;
  select id into v_loser from public.users u
    where u.account_status = 'active' and u.id <> v_winner order by u.created_at limit 1;

  if v_winner is null or v_loser is null then
    return 'skipped: needs two active users';
  end if;

  select balance_cents into v_before from public.users where id = v_winner;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status,
    bounty_share_bps, bounty_pool_cents, bounty_per_head_cents, place_pool_cents
  ) values (
    'tournament_standard', '__bounty_probe__', 1000, 8, 1000,
    8000, 800, 7200,
    'bounty', 'classic', 3, 'in_progress',
    3000, 2160, 270, 5040
  ) returning id into v_tournament_id;

  insert into public.tournament_bounties (tournament_id, head_user_id, amount_cents)
  values (v_tournament_id, v_loser, 270)
  returning id into v_bounty_id;

  insert into public.tournament_rounds (tournament_id, round_number, status, started_at)
  values (v_tournament_id, 1, 'in_progress', now())
  returning id into v_round_id;

  insert into public.tournament_matches (tournament_id, round_id, player_1_id, player_2_id, board_position, status)
  values (v_tournament_id, v_round_id, v_winner, v_loser, 1, 'pending')
  returning id into v_tm_id;

  perform public.record_tournament_match_result(v_tm_id, v_winner, null);

  select balance_cents into v_after from public.users where id = v_winner;
  if v_after <> v_before + 270 then
    raise exception 'Expected bounty payout of 270, balance moved by %', v_after - v_before;
  end if;

  if not exists (
    select 1 from public.tournament_bounties
    where id = v_bounty_id and claimed_by_user_id = v_winner and claimed_at is not null
  ) then
    raise exception 'Bounty row was not marked claimed';
  end if;

  -- Idempotency: calling again on an already-completed match must not pay twice.
  perform public.record_tournament_match_result(v_tm_id, v_winner, null);

  select balance_cents into v_after from public.users where id = v_winner;
  if v_after <> v_before + 270 then
    raise exception 'Idempotency failed: bounty paid more than once';
  end if;

  return 'ok: bounty claimed and paid exactly once';
end;
$$;

revoke execute on function public.assert_bounty_claim_works() from anon, authenticated;
