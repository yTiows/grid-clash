-- =============================================================================
-- Migration: restore the weekly loss-limit check dropped by migration 21
--
-- FOUND BY: reading assert_can_wager() end to end against migration 11 (the
-- original version, which checked both daily_loss_limit_cents and
-- weekly_loss_limit_cents) and comparing it to migration 21's replacement,
-- which only carried the daily check forward.
--
-- BUG: migration 21 rewrote assert_can_wager() to add identifier-based
-- self-exclusion (GAP 2) and, in doing so, silently dropped the
-- weekly_loss_limit_cents branch migration 11 had. player_limits.
-- weekly_loss_limit_cents is a real, settable responsible-gaming control —
-- the column exists, the settings UI can write to it — but nothing has
-- enforced it since migration 21 landed. A player who sets a weekly loss
-- limit gets no protection from it, which is exactly the kind of silent
-- regression this codebase's own migration history warns is invisible to a
-- clean `create or replace function` apply.
--
-- FIX: re-add the weekly check, keeping migration 21's identifier-exclusion
-- additions intact.
-- =============================================================================

create or replace function public.assert_can_wager(
  p_user_id uuid,
  p_stake_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_jurisdiction record;
  v_limits record;
  v_today_lost integer;
  v_week_lost integer;
  v_today_deposited integer;
  v_phone_hash text;
  v_kyc_hash text;
begin
  if p_stake_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception 'Account not found';
  end if;

  if v_user.account_status <> 'active' then
    raise exception 'Account is not active (%)', v_user.account_status;
  end if;

  if public.is_self_excluded(p_user_id) then
    raise exception 'Account is self-excluded';
  end if;

  select public.hash_phone(phone_number) into v_phone_hash
  from public.users where id = p_user_id and phone_verified and phone_number is not null;

  if v_phone_hash is not null and public.is_identifier_excluded('phone', v_phone_hash) then
    raise exception 'Account is self-excluded';
  end if;

  select id_number_hash into v_kyc_hash
  from public.kyc_records
  where user_id = p_user_id and status = 'approved' and id_number_hash is not null
  order by created_at desc
  limit 1;

  if v_kyc_hash is not null and public.is_identifier_excluded('kyc_document', v_kyc_hash) then
    raise exception 'Account is self-excluded';
  end if;

  if not v_user.phone_verified then
    raise exception 'Phone verification required before paid entry';
  end if;

  select * into v_jurisdiction
  from public.jurisdiction_rules
  where country_code = coalesce(v_user.kyc_country, 'US')
  order by region_code nulls last
  limit 1;

  if v_jurisdiction.id is not null and not v_jurisdiction.paid_entry_allowed then
    raise exception 'Paid entry is not available in this jurisdiction';
  end if;

  select * into v_limits from public.player_limits where user_id = p_user_id;

  if v_limits.user_id is not null then
    select coalesce(net_loss_cents, 0), coalesce(deposited_cents, 0)
    into v_today_lost, v_today_deposited
    from public.deposit_velocity
    where user_id = p_user_id and window_date = current_date;

    if v_limits.daily_loss_limit_cents is not null
       and coalesce(v_today_lost, 0) + p_stake_cents > v_limits.daily_loss_limit_cents then
      raise exception 'Daily loss limit reached';
    end if;

    if v_limits.weekly_loss_limit_cents is not null then
      select coalesce(sum(net_loss_cents), 0) into v_week_lost
      from public.deposit_velocity
      where user_id = p_user_id and window_date > current_date - 7;

      if coalesce(v_week_lost, 0) + p_stake_cents > v_limits.weekly_loss_limit_cents then
        raise exception 'Weekly loss limit reached';
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.assert_can_wager(uuid, integer) from anon, authenticated;
