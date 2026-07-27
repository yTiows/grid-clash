-- =============================================================================
-- Migration: enforce the self-attested age gate at the money boundary
--
-- FOUND BY: reading migration 13 (age_gate) end to end against assert_can_wager
-- and check_deposit_allowed. Migration 13 added
-- users.date_of_birth_self_attested with a CHECK that only fires when the
-- column is non-null ("... is null or ... <= 18 years ago") — it never
-- requires a value. The signup form and signUpAction (src/actions/auth.ts)
-- collect and write it, but that write is explicitly best-effort: if it
-- fails or is skipped, nothing downstream ever notices.
--
-- IMPACT: an account with a null date_of_birth_self_attested — pre-dating
-- this column, or one whose best-effort post-signup UPDATE never landed —
-- could wager and deposit with no age attestation on file at all. Every
-- other identity gate in this schema (phone before wager, KYC before
-- withdrawal) is enforced at the money boundary, not just collected at
-- signup; age was the one exception.
--
-- FIX: assert_can_wager and check_deposit_allowed both require a self-attested
-- DOB and accepted terms before money moves, alongside the existing phone/
-- jurisdiction/exclusion checks. This does not touch what counts as
-- underage (the >= 18 years CHECK from migration 13, a legal-review item
-- covered separately) — it only closes the gap where no attestation at all
-- was silently treated as acceptable.
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

  if v_user.date_of_birth_self_attested is null or v_user.terms_accepted_at is null then
    raise exception 'Age attestation and terms acceptance required before paid entry';
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

-- Deposit-side counterpart. A player should not be able to fund an account
-- that could never legally wager the money either.
create or replace function public.check_deposit_allowed(
  p_user_id uuid,
  p_amount_cents integer
)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user record;
  v_limits record;
  v_today_deposited integer;
begin
  select * into v_user from public.users where id = p_user_id;
  if not found then
    return query select false, 'Account not found';
    return;
  end if;

  if public.is_self_excluded(p_user_id) then
    return query select false, 'Account is self-excluded';
    return;
  end if;

  if v_user.date_of_birth_self_attested is null or v_user.terms_accepted_at is null then
    return query select false, 'Age attestation and terms acceptance required before deposit';
    return;
  end if;

  select * into v_limits from public.player_limits where user_id = p_user_id;
  if v_limits.user_id is null then
    return query select true, null::text;
    return;
  end if;

  select coalesce(deposited_cents, 0) into v_today_deposited
  from public.deposit_velocity
  where user_id = p_user_id and window_date = current_date;

  if v_limits.daily_deposit_limit_cents is not null
     and coalesce(v_today_deposited, 0) + p_amount_cents > v_limits.daily_deposit_limit_cents then
    return query select false,
      format('This would exceed your daily deposit limit of %s.',
        to_char(v_limits.daily_deposit_limit_cents / 100.0, 'FM999,999,990.00'));
    return;
  end if;

  return query select true, null::text;
end;
$$;

revoke execute on function public.check_deposit_allowed(uuid, integer) from anon;
grant execute on function public.check_deposit_allowed(uuid, integer) to authenticated;
