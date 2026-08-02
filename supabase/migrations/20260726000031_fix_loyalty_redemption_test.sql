-- Reconstructed migration file — see note below.
--
-- Per migration 20260726000030's own trailing comment ("Superseded by
-- migration 31 (test-isolation fix) and migration 33 (absolute-vs-relative
-- assertion fix)"), this migration WAS applied to the live project (it
-- appears in the live migration history as
-- "20260726000031_fix_loyalty_redemption_test") but its .sql file was never
-- committed to this repo — a real live/repo drift caught by the Phase 1
-- verification pass (2026-08-01). Supabase's migration history table
-- records only the applied version + name, not the SQL text, so the exact
-- original body is not recoverable byte-for-byte.
--
-- This reconstruction is written to match what the historical record
-- implies: a test-isolation fix ONLY — giving the insufficient-points
-- refusal case its own never-entered tournament (v_t3) instead of reusing
-- v_t1 (which migration 33's comment says was "really testing 'Already
-- entered', not insufficient points") — while still carrying the absolute
-- (not yet relative) remaining-points assertion that migration 33 later
-- replaced. It is NOT applied here via apply_migration: it is already live,
-- and migration 20260726000033_fix_loyalty_test_absolute_assertion.sql
-- (already in this repo, already live, confirmed byte-identical to the
-- live pg_get_functiondef() output) fully CREATE OR REPLACEs this same
-- function immediately after, so any imprecision in this reconstruction has
-- zero effect on current live behavior. This file exists purely so local
-- migration history matches what actually ran, per this codebase's own
-- stated principle that migrations are ground truth.
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
  if v_points_after <> 200 then
    raise exception 'Expected 200 points remaining after 300+500 redeemed from 1000, got %', v_points_after;
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
  end;
  if not v_refused then
    raise exception 'Expected insufficient-points redemption to be refused';
  end if;

  if exists (select 1 from public.tournament_entries where tournament_id = v_t3 and user_id = v_user) then
    raise exception 'Refused redemption still left a tournament_entries row behind';
  end if;

  return 'ok: loyalty redemption — partial discount, full discount, and insufficient-points refusal all correct';
end;
$$;

revoke execute on function public.assert_loyalty_redemption_works() from anon, authenticated;
