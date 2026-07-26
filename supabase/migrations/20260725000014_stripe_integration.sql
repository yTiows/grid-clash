-- =============================================================================
-- Migration: Stripe identifiers and payout tracking
--
-- Adds what the deposit/withdrawal/KYC code in src/actions and
-- src/app/api/webhooks/stripe needs. Reuses existing infrastructure rather
-- than duplicating it: processed_webhook_events (migration prior) already
-- gives webhook idempotency, transactions.provider_transaction_id already has
-- a uniqueness constraint, and move_balance() is already the single money-
-- movement primitive. This migration only adds what's genuinely missing:
-- stable Stripe object references and a payout audit trail.
-- =============================================================================

alter table public.users
  add column stripe_customer_id text unique,
  add column stripe_connect_account_id text unique,
  add column stripe_connect_payouts_enabled boolean not null default false,
  add column stripe_connect_onboarded_at timestamptz;

comment on column public.users.stripe_connect_payouts_enabled is
  'Mirrors the connected account''s payouts_enabled flag from account.updated webhooks. Gate withdrawal UI on this, not on onboarded_at alone — onboarding can complete before Stripe finishes underwriting.';

-- ---------------------------------------------------------------------------
-- payouts
--
-- One row per withdrawal attempt, separate from `transactions` because a
-- payout has a Stripe-side lifecycle (created -> paid -> possibly failed)
-- that outlives the single debit transaction, and because failure requires a
-- compensating credit back to the user — that credit is a distinct ledger
-- event and needs its own row to reference.
-- ---------------------------------------------------------------------------
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount_cents integer not null,
  stripe_transfer_id text unique,
  status text not null default 'pending',
  failure_reason text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint payouts_amount_check check (amount_cents > 0),
  constraint payouts_status_check check (
    status in ('pending', 'in_transit', 'paid', 'failed', 'reversed')
  )
);

create index payouts_user_id_idx on public.payouts (user_id);
create index payouts_status_idx on public.payouts (status);

alter table public.payouts enable row level security;
grant select on public.payouts to authenticated;
create policy "payouts_select_own" on public.payouts
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- request_withdrawal
--
-- Same debit-then-record pattern as reserve_stake, reusing assert_can_wager
-- for the shared checks (active account, not self-excluded, phone verified)
-- plus withdrawal-specific gates that wagering doesn't need.
-- ---------------------------------------------------------------------------
create or replace function public.request_withdrawal(
  p_user_id uuid,
  p_amount_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_payout_id uuid;
begin
  if p_amount_cents <= 0 then
    raise exception 'Withdrawal amount must be positive';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'Account not found';
  end if;

  if v_user.account_status <> 'active' then
    raise exception 'Account is not active (%)', v_user.account_status;
  end if;
  if public.is_self_excluded(p_user_id) then
    raise exception 'Account is self-excluded';
  end if;
  if not v_user.kyc_verified then
    raise exception 'Identity verification required before withdrawal';
  end if;
  if not v_user.stripe_connect_payouts_enabled then
    raise exception 'Payout account is not ready to receive funds';
  end if;
  if v_user.balance_cents < p_amount_cents then
    raise exception 'Insufficient balance';
  end if;

  perform public.move_balance(p_user_id, -p_amount_cents, 'withdrawal', 'withdrawal_hold:' || gen_random_uuid()::text);

  insert into public.payouts (user_id, amount_cents, status)
  values (p_user_id, p_amount_cents, 'pending')
  returning id into v_payout_id;

  return v_payout_id;
end;
$$;

revoke execute on function public.request_withdrawal(uuid, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_withdrawal_outcome
--
-- Called from the Stripe webhook once a Transfer resolves. On failure, the
-- held amount is credited back — the same money-conservation discipline as
-- everywhere else in this schema: nothing is ever debited without either a
-- matching credit elsewhere or a terminal record of where it went.
-- ---------------------------------------------------------------------------
create or replace function public.record_withdrawal_outcome(
  p_payout_id uuid,
  p_stripe_transfer_id text,
  p_status text,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout record;
begin
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout % not found', p_payout_id;
  end if;

  -- Idempotent: a status already terminal does not get re-processed, so a
  -- retried webhook delivery cannot double-refund a failed payout.
  if v_payout.status in ('paid', 'failed', 'reversed') then
    return;
  end if;

  update public.payouts
  set status = p_status,
      stripe_transfer_id = coalesce(p_stripe_transfer_id, stripe_transfer_id),
      failure_reason = p_failure_reason,
      completed_at = case when p_status in ('paid', 'failed', 'reversed') then now() else completed_at end
  where id = p_payout_id;

  if p_status in ('failed', 'reversed') then
    perform public.move_balance(
      v_payout.user_id, v_payout.amount_cents, 'withdrawal_reversed',
      'withdrawal_reversed:' || p_payout_id::text
    );
  end if;
end;
$$;

revoke execute on function public.record_withdrawal_outcome(uuid, text, text, text) from anon, authenticated;
