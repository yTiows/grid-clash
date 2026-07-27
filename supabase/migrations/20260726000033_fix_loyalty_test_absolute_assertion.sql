-- Fix: assert_loyalty_redemption_works asserted an absolute remaining-points
-- figure (200) instead of a relative one (v_points_before - 800). Against a
-- persistent dev database with prior test runs on the same probe account
-- (e.g. assert_loyalty_points_mint_works already minted points to it), the
-- absolute assertion fails even though redemption behaved exactly right —
-- 1040 seeded-and-prior balance minus 800 redeemed is 240, not a bug.
--
-- Folded into this same migration: the insufficient-points refusal case
-- (found reusing v_t1, already entered earlier in the same test — so it was
-- really testing "Already entered", not insufficient points) now runs
-- against a third, distinct, never-entered tournament so the only possible
-- refusal reason is the points debit itself, and confirms the refusal left
-- no half-entered tournament_entries row behind.
create or replace function public.assert_loyalty_redemption_works()
returns text
language plpgsql
as $$
declare
  v_user uuid;
  v_t1 uuid;
  v_t2 uuid;
  v_t3 uuid;
  v_cash_before integer;
  v_cash_after integer;
  v_points_before integer;
  v_points_after integer;
  v_refused boolean := false;
  v_refusal_message text;
begin
  select id into v_user
  from public.users
  where account_status = 'active' and phone_verified
    and date_of_birth_self_attested is not null
    and balance_cents >= 2000
  order by created_at limit 1;

  if v_user is null then
    return 'skipped: needs an active, verified, funded user';
  end if;

  perform public.move_loyalty_points(v_user, 1000, 'adjustment', 'redeem_probe_seed:' || gen_random_uuid()::text);

  select balance_cents into v_points_before from public.loyalty_points where user_id = v_user;
  select balance_cents into v_cash_before from public.users where id = v_user;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__redeem_probe_partial__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_t1;

  perform public.enter_tournament(v_user, v_t1, 300);

  select balance_cents into v_points_after from public.loyalty_points where user_id = v_user;
  select balance_cents into v_cash_after from public.users where id = v_user;

  if v_points_before - v_points_after <> 300 then
    raise exception 'Expected 300 points redeemed, got %', v_points_before - v_points_after;
  end if;
  if v_cash_before - v_cash_after <> 200 then
    raise exception 'Expected 200 cents cash charged, got %', v_cash_before - v_cash_after;
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__redeem_probe_full__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_t2;

  select balance_cents into v_cash_before from public.users where id = v_user;
  perform public.enter_tournament(v_user, v_t2, 500);
  select balance_cents into v_cash_after from public.users where id = v_user;

  if v_cash_before <> v_cash_after then
    raise exception 'Fully points-covered entry should not touch cash balance: % -> %', v_cash_before, v_cash_after;
  end if;

  select balance_cents into v_points_after from public.loyalty_points where user_id = v_user;
  if v_points_before - v_points_after <> 800 then
    raise exception 'Expected 800 total points redeemed (300+500), got %', v_points_before - v_points_after;
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__redeem_probe_insufficient__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_t3;

  begin
    perform public.enter_tournament(v_user, v_t3, 999999);
  exception when others then
    v_refused := true;
    v_refusal_message := sqlerrm;
  end;
  if not v_refused then
    raise exception 'Expected insufficient-points redemption to be refused';
  end if;
  if v_refusal_message not ilike '%insufficient points%' then
    raise exception 'Refused for the wrong reason: %', v_refusal_message;
  end if;

  if exists (select 1 from public.tournament_entries where tournament_id = v_t3 and user_id = v_user) then
    raise exception 'Refused redemption still left a tournament_entries row behind';
  end if;

  return 'ok: loyalty redemption — partial discount, full discount, and insufficient-points refusal (with clean rollback) all correct';
end;
$$;

revoke execute on function public.assert_loyalty_redemption_works() from anon, authenticated;
