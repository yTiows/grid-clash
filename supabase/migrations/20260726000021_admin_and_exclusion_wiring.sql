-- =============================================================================
-- Migration: Close two gaps flagged but not finished by earlier migrations.
--
-- FOUND BY: reading 0006's own residual-risk notes and cross-checking them
-- against what actually gets called at runtime.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- hash_phone: single source of truth for how a phone number becomes an
-- exclusion identifier. Used by both the write side (the trigger below, at
-- self-exclusion time) and the read side (assert_can_wager, at wager time).
-- Defined once so the two can never drift into hashing the same number two
-- different ways and silently failing to match.
-- ---------------------------------------------------------------------------
create or replace function public.hash_phone(p_phone text)
returns text
language sql
immutable
as $$
  select encode(digest(lower(trim(p_phone)), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- GAP 1 — is_admin() has returned a hardcoded `false` since migration 0002.
-- 0006's own residual-risk section flagged this explicitly: "It MUST be
-- implemented before any administrative surface is exposed." The admin
-- layout and every admin server action already gate on it correctly — the
-- gate was just wired to a function that never says yes. Net effect: no one,
-- including the operator, can create or complete a tournament right now.
--
-- FIX: an `is_admin` flag on `users`, defaulting false, flipped only by
-- direct SQL (there is deliberately no self-service or API path to grant
-- it — the first admin is granted by the operator running one UPDATE, see
-- SETUP.md). is_admin() reads the caller's own row via auth.uid(), so it
-- still cannot be spoofed by passing a different id.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.is_admin from public.users u where u.id = auth.uid()), false);
$$;

revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- GAP 2 — is_identifier_excluded() was built by FINDING 4 (0006) specifically
-- to stop a self-excluded person from returning under a new account, but
-- nothing ever calls it. assert_can_wager (0011) only checks is_self_excluded
-- on the *current* user_id, which is exactly the hole FINDING 4 documented:
-- self-exclude, sign up again, the new id has no exclusion row.
--
-- FIX: assert_can_wager also checks the caller's verified phone hash and, if
-- KYC-verified, their document hash, against exclusion_identifiers. Checked
-- alongside is_self_excluded, in the same cheapest-first, fail-closed spot.
--
-- This only catches identifiers the platform already has verified for the
-- new account (phone/KYC) — someone who never verifies either on the new
-- account is still caught at the money boundary (KYC is required before
-- withdrawal), just later than at wager time. Documented, not silently
-- assumed solved.
-- ---------------------------------------------------------------------------
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

  -- Catches a self-excluded person back under a new account id, via an
  -- identifier (verified phone, or KYC document) this new account already
  -- shares with an excluded one. users.phone_number is plaintext; hash_phone()
  -- is the one place that turns it into the same hash the trigger below wrote.
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
  end if;
end;
$$;

revoke execute on function public.assert_can_wager(uuid, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- GAP 2, write side — exclusion_identifiers has had no INSERT path at all
-- since 0006 created it. is_identifier_excluded() checked a table nothing
-- ever filled in, which is the same class of bug as a name that resolves but
-- was never actually reachable: it looks finished and does nothing.
--
-- FIX: on every self_exclusions insert, snapshot whatever verified identifiers
-- the excluding account has *right now* — verified phone, latest approved KYC
-- document — into exclusion_identifiers. A player who verifies a phone number
-- after excluding is not retroactively covered by this trigger alone; that gap
-- is why assert_can_wager's own phone_verified requirement still runs after
-- these checks, not instead of them.
-- ---------------------------------------------------------------------------
create or replace function public.populate_exclusion_identifiers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_phone_hash text;
  v_kyc_hash text;
begin
  select phone_number into v_phone
  from public.users
  where id = new.user_id and phone_verified and phone_number is not null;

  if v_phone is not null then
    v_phone_hash := public.hash_phone(v_phone);
    insert into public.exclusion_identifiers (self_exclusion_id, identifier_type, identifier_hash)
    values (new.id, 'phone', v_phone_hash);
  end if;

  select id_number_hash into v_kyc_hash
  from public.kyc_records
  where user_id = new.user_id and status = 'approved' and id_number_hash is not null
  order by created_at desc
  limit 1;

  if v_kyc_hash is not null then
    insert into public.exclusion_identifiers (self_exclusion_id, identifier_type, identifier_hash)
    values (new.id, 'kyc_document', v_kyc_hash);
  end if;

  return new;
end;
$$;

create trigger populate_exclusion_identifiers_on_self_exclusion
  after insert on public.self_exclusions
  for each row execute function public.populate_exclusion_identifiers();

-- ---------------------------------------------------------------------------
-- Deposit-side limit check, read-only, for the checkout action to call
-- before ever creating a Stripe session. Enforcement of loss limits already
-- lives in assert_can_wager; this is the deposit-side counterpart, checked
-- against the same player_limits/deposit_velocity rows so the two can never
-- disagree about what a player's limit is.
-- ---------------------------------------------------------------------------
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
  v_limits record;
  v_today_deposited integer;
begin
  if public.is_self_excluded(p_user_id) then
    return query select false, 'Account is self-excluded';
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

do $$
begin
  raise notice 'Migration 21: is_admin() implemented (was hardcoded false). assert_can_wager now also checks identifier-based self-exclusion. check_deposit_allowed() added for pre-checkout limit checks.';
end
$$;
