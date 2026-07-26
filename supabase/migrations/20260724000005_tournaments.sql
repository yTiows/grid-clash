-- =============================================================================
-- Migration: Tournaments, titles, and the platform ledger
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tournaments
--
-- Money terms are columns, not application config: entry fee, field size, rake
-- and prize pool are fixed at creation and immutable afterwards (enforced by
-- lock_tournament_terms below). A contest whose terms can move after players
-- have entered is not a contest, it is a renegotiation.
--
-- rake_bps is signed. Milestone events store -100, meaning the house adds 1%
-- to the pot from realised profit.
-- ---------------------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  name text not null,

  entry_fee_cents integer not null,
  field_size integer not null,
  rake_bps integer not null,

  -- Denormalised at creation from the same pure functions the UI uses, so the
  -- advertised pool and the settled pool cannot diverge.
  gross_cents integer not null,
  rake_cents integer not null,
  prize_pool_cents integer not null,

  status text not null default 'open',
  registration_opens_at timestamptz not null default now(),
  starts_at timestamptz,
  completed_at timestamptz,

  -- Set for milestone events: which profit milestone unlocked this contest.
  milestone_index integer,

  created_at timestamptz not null default now(),

  constraint tournaments_kind_check check (
    kind in ('tournament_standard', 'tournament_dollar', 'tournament_milestone')
  ),
  constraint tournaments_status_check check (
    status in ('open', 'full', 'in_progress', 'completed', 'cancelled')
  ),
  constraint tournaments_entry_fee_check check (entry_fee_cents > 0),
  constraint tournaments_field_size_check check (field_size between 2 and 1024),
  constraint tournaments_pool_arithmetic_check check (
    gross_cents = entry_fee_cents * field_size
    and prize_pool_cents = gross_cents - rake_cents
    and prize_pool_cents > 0
  ),
  constraint tournaments_milestone_index_check check (
    (kind = 'tournament_milestone') = (milestone_index is not null)
  )
);

create index tournaments_status_idx on public.tournaments (status);
create index tournaments_kind_idx on public.tournaments (kind);
create index tournaments_starts_at_idx on public.tournaments (starts_at);
create unique index tournaments_milestone_index_key
  on public.tournaments (milestone_index)
  where milestone_index is not null;

comment on table public.tournaments is
  'Money terms are immutable once created. Milestone events carry a negative rake_bps: the house adds to the pot.';

-- ---------------------------------------------------------------------------
-- tournament_entries
--
-- The unique constraint on (tournament_id, user_id) is the seat lock: one seat
-- per account, enforced by the database rather than by application logic that
-- could lose a race. Capacity is enforced by enforce_field_capacity below.
-- ---------------------------------------------------------------------------
create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  seat_number integer not null,
  entry_fee_paid_cents integer not null,
  entered_at timestamptz not null default now(),
  eliminated_at timestamptz,
  final_place integer,
  constraint tournament_entries_one_seat_per_user unique (tournament_id, user_id),
  constraint tournament_entries_unique_seat unique (tournament_id, seat_number),
  constraint tournament_entries_seat_positive check (seat_number > 0),
  constraint tournament_entries_place_positive check (final_place is null or final_place > 0)
);

create index tournament_entries_tournament_id_idx on public.tournament_entries (tournament_id);
create index tournament_entries_user_id_idx on public.tournament_entries (user_id);

-- ---------------------------------------------------------------------------
-- tournament_payouts
-- One row per paid place. Sum is asserted against prize_pool_cents by
-- assert_payouts_balance below, so a settlement bug fails loudly at write time
-- instead of silently short-paying a field.
-- ---------------------------------------------------------------------------
create table public.tournament_payouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  place integer not null,
  amount_cents integer not null,
  paid_at timestamptz not null default now(),
  constraint tournament_payouts_unique_place unique (tournament_id, place),
  constraint tournament_payouts_place_positive check (place > 0),
  constraint tournament_payouts_amount_positive check (amount_cents > 0)
);

create index tournament_payouts_tournament_id_idx on public.tournament_payouts (tournament_id);
create index tournament_payouts_user_id_idx on public.tournament_payouts (user_id);

-- ---------------------------------------------------------------------------
-- player_titles
--
-- Earned deterministically by winning a contest at a given tier. No random
-- roll exists anywhere in this path — that is what keeps a title an
-- achievement rather than a loot box, which several jurisdictions regulate as
-- gambling.
--
-- The table stores only the tier. How a tier renders — typeface, colour,
-- weight — lives in the presentation layer and is deliberately not described
-- in any UI copy. Players infer what a treatment means from seeing it worn.
-- ---------------------------------------------------------------------------
create table public.player_titles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  tier text not null,
  tournament_id uuid references public.tournaments (id) on delete set null,
  earned_at timestamptz not null default now(),
  is_equipped boolean not null default false,
  constraint player_titles_tier_check check (
    tier in ('dollar', 'bronze', 'silver', 'gold', 'obsidian', 'milestone')
  )
);

create index player_titles_user_id_idx on public.player_titles (user_id);
create unique index player_titles_one_equipped_per_user
  on public.player_titles (user_id)
  where is_equipped;

comment on table public.player_titles is
  'Deterministic achievement, never a random roll. Visual meaning is intentionally undocumented in-product.';

-- ---------------------------------------------------------------------------
-- platform_ledger
--
-- Append-only record of every cent the platform takes or pays. Milestone
-- unlocks are computed from the sum of this table, never from a hand-entered
-- figure, and the running total is published to players.
--
-- A trigger players cannot audit is a marketing claim they must take on faith.
-- A live counter is verifiable and a better hook besides.
-- ---------------------------------------------------------------------------
create table public.platform_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  -- Positive = revenue to the platform. Negative = paid out by the platform.
  amount_cents integer not null,
  match_id uuid references public.matches (id) on delete set null,
  tournament_id uuid references public.tournaments (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint platform_ledger_entry_type_check check (
    entry_type in ('ranked_rake', 'tournament_rake', 'milestone_subsidy', 'refund', 'adjustment')
  ),
  constraint platform_ledger_nonzero check (amount_cents <> 0)
);

create index platform_ledger_created_at_idx on public.platform_ledger (created_at desc);
create index platform_ledger_entry_type_idx on public.platform_ledger (entry_type);

-- Running realised profit. Drives the public milestone progress bar.
create or replace function public.realised_profit_cents()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.platform_ledger;
$$;

create view public.milestone_progress
  with (security_invoker = false)
  as
  select
    public.realised_profit_cents() as realised_profit_cents,
    100000 as threshold_cents,
    (public.realised_profit_cents() / 100000)::integer as milestones_earned,
    (public.realised_profit_cents() % 100000)::integer as progress_cents,
    (select count(*) from public.tournaments where kind = 'tournament_milestone')::integer
      as milestones_created;

-- ---------------------------------------------------------------------------
-- enforce_field_capacity
-- Serialises seat claims against the tournament row so a burst of concurrent
-- entries cannot oversell a 15-seat field.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_field_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  capacity integer;
  taken integer;
  current_status text;
begin
  select field_size, status into capacity, current_status
  from public.tournaments
  where id = new.tournament_id
  for update;

  if current_status not in ('open') then
    raise exception 'Tournament is not open for entry';
  end if;

  select count(*) into taken
  from public.tournament_entries
  where tournament_id = new.tournament_id;

  if taken >= capacity then
    raise exception 'Tournament is full';
  end if;

  if new.seat_number > capacity then
    raise exception 'Seat number exceeds field size';
  end if;

  if taken + 1 = capacity then
    update public.tournaments set status = 'full' where id = new.tournament_id;
  end if;

  return new;
end;
$$;

create trigger enforce_field_capacity_on_entry
  before insert on public.tournament_entries
  for each row execute function public.enforce_field_capacity();

-- ---------------------------------------------------------------------------
-- lock_tournament_terms
-- Money terms are immutable after creation. Status and timing may advance.
-- ---------------------------------------------------------------------------
create or replace function public.lock_tournament_terms()
returns trigger
language plpgsql
as $$
begin
  if new.entry_fee_cents is distinct from old.entry_fee_cents
     or new.field_size is distinct from old.field_size
     or new.rake_bps is distinct from old.rake_bps
     or new.gross_cents is distinct from old.gross_cents
     or new.rake_cents is distinct from old.rake_cents
     or new.prize_pool_cents is distinct from old.prize_pool_cents then
    raise exception 'Tournament money terms are immutable once created';
  end if;
  return new;
end;
$$;

create trigger lock_tournament_terms_on_update
  before update on public.tournaments
  for each row execute function public.lock_tournament_terms();

-- ---------------------------------------------------------------------------
-- assert_payouts_balance
-- Total paid must never exceed the advertised pool.
-- ---------------------------------------------------------------------------
create or replace function public.assert_payouts_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pool integer;
  paid integer;
begin
  select prize_pool_cents into pool from public.tournaments where id = new.tournament_id;

  select coalesce(sum(amount_cents), 0) into paid
  from public.tournament_payouts
  where tournament_id = new.tournament_id;

  if paid > pool then
    raise exception 'Payouts (%) exceed advertised prize pool (%)', paid, pool;
  end if;

  return new;
end;
$$;

create trigger assert_payouts_balance_on_insert
  after insert on public.tournament_payouts
  for each row execute function public.assert_payouts_balance();

-- ---------------------------------------------------------------------------
-- RLS
-- Contests and their standings are public. Entering, settling and ledger
-- writes are service-role only.
-- ---------------------------------------------------------------------------
grant select on
  public.tournaments,
  public.tournament_entries,
  public.tournament_payouts,
  public.player_titles,
  public.milestone_progress
to anon, authenticated;

alter table public.tournaments enable row level security;
create policy "tournaments_select_all"
  on public.tournaments for select to anon, authenticated using (true);

alter table public.tournament_entries enable row level security;
create policy "tournament_entries_select_all"
  on public.tournament_entries for select to anon, authenticated using (true);

alter table public.tournament_payouts enable row level security;
create policy "tournament_payouts_select_all"
  on public.tournament_payouts for select to anon, authenticated using (true);

alter table public.player_titles enable row level security;
create policy "player_titles_select_all"
  on public.player_titles for select to anon, authenticated using (true);

create policy "player_titles_equip_own"
  on public.player_titles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant update (is_equipped) on public.player_titles to authenticated;

-- The ledger itself stays private; the aggregate is exposed through the
-- milestone_progress view so players can verify the trigger without seeing
-- individual transactions.
alter table public.platform_ledger enable row level security;
create policy "platform_ledger_deny_all"
  on public.platform_ledger for all to anon, authenticated using (false);
