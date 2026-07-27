-- =============================================================================
-- Migration: loyalty points — ranked rake funds a tournament-only discount
--
-- Per CLAUDE_CODE_BRIEF.md §5.2. Same append-only-ledger-plus-cache shape as
-- balance_entries/move_balance (migration 6): a scalar cache column is not
-- auditable, so points get the identical treatment real money gets.
--
-- Points are denominated directly in cents of future tournament-entry
-- discount (1 point = $0.01 off), so redemption never needs a second
-- exchange-rate constant. Minted at 20% of ranked rake, split between both
-- players in proportion to what each paid into the settled pot — the same
-- rakeback shape poker VIP programs use. Never convertible to cash, never
-- usable in ranked: the whole point is a controlled, self-funded pull toward
-- tournaments, not a second currency.
-- =============================================================================

create table public.loyalty_points (
  user_id uuid primary key references public.users (id) on delete cascade,
  balance_cents integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint loyalty_points_balance_nonneg check (balance_cents >= 0)
);

create table public.loyalty_points_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  amount_cents integer not null,
  balance_after_cents integer not null,
  reason text not null,
  match_id uuid references public.matches (id) on delete set null,
  tournament_id uuid references public.tournaments (id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint loyalty_points_entries_nonzero check (amount_cents <> 0),
  constraint loyalty_points_entries_never_negative check (balance_after_cents >= 0),
  constraint loyalty_points_entries_reason_check check (
    reason in ('ranked_rake', 'tournament_redemption', 'first_tournament_bonus', 'adjustment')
  )
);

create unique index loyalty_points_entries_idempotency_key_uidx
  on public.loyalty_points_entries (idempotency_key);
create index loyalty_points_entries_user_id_idx
  on public.loyalty_points_entries (user_id, created_at desc);

comment on table public.loyalty_points_entries is
  'Append-only. loyalty_points.balance_cents is a cache of sum(amount_cents); this table is the source of truth. Never redeemable for cash, never usable in ranked.';

alter table public.loyalty_points enable row level security;
create policy "loyalty_points_select_own" on public.loyalty_points
  for select to authenticated using (auth.uid() = user_id);
grant select on public.loyalty_points to authenticated;

alter table public.loyalty_points_entries enable row level security;
create policy "loyalty_points_entries_select_own" on public.loyalty_points_entries
  for select to authenticated using (auth.uid() = user_id);
grant select on public.loyalty_points_entries to authenticated;

-- ---------------------------------------------------------------------------
-- move_loyalty_points — the only sanctioned path for point balance changes.
-- Identical shape to move_balance: check-and-write in one statement,
-- idempotency key makes every call replay-safe.
-- ---------------------------------------------------------------------------
create or replace function public.move_loyalty_points(
  p_user_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_idempotency_key text,
  p_match_id uuid default null,
  p_tournament_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
  v_existing integer;
begin
  if p_amount_cents = 0 then
    raise exception 'move_loyalty_points: amount must be non-zero';
  end if;

  select balance_after_cents into v_existing
  from public.loyalty_points_entries
  where idempotency_key = p_idempotency_key;

  if found then
    return v_existing;
  end if;

  insert into public.loyalty_points (user_id, balance_cents)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.loyalty_points
  set balance_cents = balance_cents + p_amount_cents,
      updated_at = now()
  where user_id = p_user_id
    and balance_cents + p_amount_cents >= 0
  returning balance_cents into v_new_balance;

  if not found then
    raise exception 'move_loyalty_points: insufficient points or unknown user'
      using errcode = 'check_violation';
  end if;

  insert into public.loyalty_points_entries (
    user_id, amount_cents, balance_after_cents, reason, match_id, tournament_id, idempotency_key
  ) values (
    p_user_id, p_amount_cents, v_new_balance, p_reason, p_match_id, p_tournament_id, p_idempotency_key
  );

  return v_new_balance;
end;
$$;

revoke all on function public.move_loyalty_points from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Minting. Fires on every ranked_rake ledger entry, splitting 20% of the
-- rake between both players in proportion to what each paid the pot — same
-- split every settlement already uses (both players staked the same amount).
-- ---------------------------------------------------------------------------
create or replace function public.mint_loyalty_points_from_rake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_total_points integer;
  v_winner_points integer;
  v_loser_points integer;
begin
  if new.entry_type <> 'ranked_rake' or new.match_id is null then
    return new;
  end if;

  select winner_id, loser_id into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;

  v_total_points := floor(new.amount_cents * 2000 / 10000.0)::integer;
  if v_total_points <= 0 then
    return new;
  end if;

  v_winner_points := v_total_points - (v_total_points / 2);
  v_loser_points := v_total_points / 2;

  if v_winner_points > 0 then
    perform public.move_loyalty_points(
      v_match.winner_id, v_winner_points, 'ranked_rake',
      'loyalty_mint:' || new.id::text || ':winner', new.match_id
    );
  end if;
  if v_loser_points > 0 then
    perform public.move_loyalty_points(
      v_match.loser_id, v_loser_points, 'ranked_rake',
      'loyalty_mint:' || new.id::text || ':loser', new.match_id
    );
  end if;

  return new;
end;
$$;

create trigger mint_loyalty_points_on_ranked_rake
  after insert on public.platform_ledger
  for each row execute function public.mint_loyalty_points_from_rake();

-- ---------------------------------------------------------------------------
-- assert_loyalty_points_mint_works
-- ---------------------------------------------------------------------------
create or replace function public.assert_loyalty_points_mint_works()
returns text
language plpgsql
as $$
declare
  v_a uuid;
  v_b uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_match uuid := gen_random_uuid();
  v_a_before integer;
  v_b_before integer;
  v_a_after integer;
  v_b_after integer;
begin
  select id into v_a from public.users u
   where u.account_status = 'active' and u.phone_verified
     and u.date_of_birth_self_attested is not null
     and not public.is_self_excluded(u.id)
   order by u.created_at limit 1;
  select id into v_b from public.users u
   where u.account_status = 'active' and u.phone_verified
     and u.date_of_birth_self_attested is not null
     and u.id <> v_a and not public.is_self_excluded(u.id)
   order by u.created_at limit 1;

  if v_a is null or v_b is null then
    return 'skipped: needs two active verified users';
  end if;
  if (select balance_cents from public.users where id = v_a) < 100
     or (select balance_cents from public.users where id = v_b) < 100 then
    return 'skipped: probe users need a balance';
  end if;

  select coalesce(balance_cents, 0) into v_a_before from public.loyalty_points where user_id = v_a;
  select coalesce(balance_cents, 0) into v_b_before from public.loyalty_points where user_id = v_b;

  v_r1 := public.reserve_stake(v_a, 10000);
  v_r2 := public.reserve_stake(v_b, 10000);

  perform public.settle_ranked_match(
    v_match, v_r1, v_r2, v_a, v_b, false,
    10000, 400, 19600, 1, -1, 'line', 10,
    '{"probe":true}'::jsonb, ARRAY['probe'], ARRAY[100], ARRAY[100]
  );

  select coalesce(balance_cents, 0) into v_a_after from public.loyalty_points where user_id = v_a;
  select coalesce(balance_cents, 0) into v_b_after from public.loyalty_points where user_id = v_b;

  -- 20% of 400 = 80 points total, split 40/40.
  if (v_a_after - v_a_before) <> 40 or (v_b_after - v_b_before) <> 40 then
    raise exception 'Expected +40/+40 loyalty points, got +% / +%', v_a_after - v_a_before, v_b_after - v_b_before;
  end if;

  return 'ok: loyalty points minted from ranked rake, split evenly';
end;
$$;

revoke execute on function public.assert_loyalty_points_mint_works() from anon, authenticated;
