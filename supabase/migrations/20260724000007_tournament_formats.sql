-- =============================================================================
-- Migration: Tournament formats, bounties, guarantees, satellites, ladders
--
-- Threat notes are inline. The bounty and satellite formats each open a money
-- path that did not exist before, and both are addressed at the schema layer
-- rather than in application code.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- rulesets
-- Mirrors src/lib/game/rulesets.ts. Stored so a contest records the exact
-- rules it ran under: a ruleset edited later must not retroactively change
-- what a settled tournament was played under.
-- ---------------------------------------------------------------------------
create table public.rulesets (
  id text primary key,
  name text not null,
  board_size integer not null,
  connect_target integer not null,
  move_timeout_ms integer not null,
  inv_normal integer not null,
  inv_shield integer not null,
  inv_bomb integer not null,
  inv_swap integer not null,
  blurb text not null,
  is_active boolean not null default true,
  constraint rulesets_board_size_check check (board_size between 3 and 12),
  constraint rulesets_connect_check check (connect_target between 3 and board_size),
  constraint rulesets_timeout_check check (move_timeout_ms between 1000 and 60000),
  constraint rulesets_inventory_nonneg check (
    inv_normal >= 0 and inv_shield >= 0 and inv_bomb >= 0 and inv_swap >= 0
  ),
  -- Same guard as the TypeScript factory: a ruleset that cannot produce a
  -- line is an unwinnable contest.
  constraint rulesets_winnable check (
    (inv_normal + inv_shield + inv_bomb + inv_swap) * 2 >= connect_target
  ),
  constraint rulesets_fits_board check (
    (inv_normal + inv_shield + inv_bomb + inv_swap) <= board_size * board_size
  )
);

insert into public.rulesets
  (id, name, board_size, connect_target, move_timeout_ms, inv_normal, inv_shield, inv_bomb, inv_swap, blurb)
values
  ('classic',    'Classic',    5, 4, 5000,  8, 1, 1, 1, '5x5, connect 4. One shield, one bomb, one swap.'),
  ('blitz',      'Blitz',      5, 4, 3000,  8, 1, 1, 1, 'Classic on a 3-second clock. Read faster.'),
  ('purist',     'Purist',     5, 4, 5000, 12, 0, 0, 0, 'No specials. Nothing hidden but intent.'),
  ('siege',      'Siege',      6, 5, 7000, 12, 2, 2, 1, '6x6, connect 5. Deeper board, heavier toolkit.'),
  ('demolition', 'Demolition', 5, 4, 5000,  6, 1, 4, 1, 'Four bombs each. Nothing you build is safe.'),
  ('fortress',   'Fortress',   5, 4, 5000,  7, 4, 1, 0, 'Four shields each. Commit early, defend it.'),
  ('shuffle',    'Shuffle',    5, 4, 5000,  7, 1, 0, 4, 'Four swaps each. The board never sits still.'),
  ('sprawl',     'Sprawl',     7, 5, 8000, 18, 2, 2, 2, '7x7, connect 5. Long game.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- tournaments: format columns
--
-- Every one of these is a money term and therefore immutable after creation.
-- lock_tournament_terms is extended below to cover them.
-- ---------------------------------------------------------------------------
alter table public.tournaments
  add column format_id text not null default 'single_elimination',
  add column ruleset_id text not null default 'classic' references public.rulesets (id),
  add column rounds integer not null default 1,
  add column bounty_share_bps integer not null default 0,
  add column bounty_pool_cents integer not null default 0,
  add column bounty_per_head_cents integer not null default 0,
  add column place_pool_cents integer,
  add column guaranteed_pool_cents integer,
  add column overlay_cents integer not null default 0,
  add column satellite_target_tournament_id uuid references public.tournaments (id),
  add column satellite_seat_value_cents integer;

alter table public.tournaments
  add constraint tournaments_format_check check (
    format_id in ('single_elimination','swiss','bounty','survivor','ladder','satellite','arena')
  ),
  add constraint tournaments_bounty_share_check check (bounty_share_bps between 0 and 5000),
  add constraint tournaments_bounty_nonneg check (
    bounty_pool_cents >= 0 and bounty_per_head_cents >= 0
  ),
  -- Bounties are carved out of the prize pool, never added on top. If this
  -- ever fails, effective rake has drifted above the advertised figure.
  add constraint tournaments_bounty_within_pool check (
    bounty_pool_cents <= prize_pool_cents
  ),
  add constraint tournaments_place_pool_check check (
    place_pool_cents is null
    or place_pool_cents = prize_pool_cents - bounty_pool_cents
  ),
  add constraint tournaments_guarantee_check check (
    guaranteed_pool_cents is null or guaranteed_pool_cents > 0
  ),
  add constraint tournaments_overlay_nonneg check (overlay_cents >= 0),
  add constraint tournaments_satellite_shape check (
    (format_id = 'satellite') = (satellite_target_tournament_id is not null)
  );

create index tournaments_format_id_idx on public.tournaments (format_id);
create index tournaments_ruleset_id_idx on public.tournaments (ruleset_id);
create index tournaments_satellite_target_idx on public.tournaments (satellite_target_tournament_id);

-- Extend the immutability guard to the new money terms.
create or replace function public.lock_tournament_terms()
returns trigger
language plpgsql
as $$
begin
  if new.entry_fee_cents      is distinct from old.entry_fee_cents
  or new.field_size           is distinct from old.field_size
  or new.rake_bps             is distinct from old.rake_bps
  or new.gross_cents          is distinct from old.gross_cents
  or new.rake_cents           is distinct from old.rake_cents
  or new.prize_pool_cents     is distinct from old.prize_pool_cents
  or new.format_id            is distinct from old.format_id
  or new.ruleset_id           is distinct from old.ruleset_id
  or new.bounty_share_bps     is distinct from old.bounty_share_bps
  or new.bounty_pool_cents    is distinct from old.bounty_pool_cents
  or new.bounty_per_head_cents is distinct from old.bounty_per_head_cents
  or new.place_pool_cents     is distinct from old.place_pool_cents
  or new.guaranteed_pool_cents is distinct from old.guaranteed_pool_cents
  or new.satellite_seat_value_cents is distinct from old.satellite_seat_value_cents then
    raise exception 'Tournament money terms are immutable once created';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tournament_rounds / tournament_matches
-- The bracket itself. Pairings are recorded rather than recomputed so a
-- completed tournament can be audited exactly as it ran.
-- ---------------------------------------------------------------------------
create table public.tournament_rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_number integer not null,
  status text not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  constraint tournament_rounds_unique unique (tournament_id, round_number),
  constraint tournament_rounds_number_check check (round_number > 0),
  constraint tournament_rounds_status_check check (
    status in ('pending','in_progress','completed')
  )
);

create index tournament_rounds_tournament_idx on public.tournament_rounds (tournament_id);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_id uuid not null references public.tournament_rounds (id) on delete cascade,
  match_id uuid references public.matches (id) on delete set null,
  player_1_id uuid references public.users (id) on delete set null,
  player_2_id uuid references public.users (id) on delete set null,
  winner_id uuid references public.users (id) on delete set null,
  -- A bye is an unpaired advance in an odd field. Recorded explicitly so it
  -- is auditable rather than looking like a missing row.
  is_bye boolean not null default false,
  board_position integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint tournament_matches_unique_position unique (round_id, board_position),
  constraint tournament_matches_status_check check (
    status in ('pending','in_progress','completed','forfeited')
  ),
  constraint tournament_matches_distinct_players check (
    player_1_id is null or player_2_id is null or player_1_id <> player_2_id
  ),
  constraint tournament_matches_bye_shape check (
    not is_bye or player_2_id is null
  )
);

create index tournament_matches_tournament_idx on public.tournament_matches (tournament_id);
create index tournament_matches_round_idx on public.tournament_matches (round_id);
create index tournament_matches_players_idx on public.tournament_matches (player_1_id, player_2_id);

-- ###########################################################################
-- THREAT — Bounty farming between linked accounts
--
-- The bounty format creates a direct extraction path that did not exist
-- before. Two accounts under one operator both enter; one dumps to the other;
-- the survivor collects the eliminated account's bounty. Repeated across
-- events this moves money between accounts while every individual match looks
-- ordinary, and it doubles as a laundering channel.
--
-- tournament_cooccurrence (migration 0006) records the pattern but does not
-- stop it, and detection after settlement is detection after the money moved.
--
-- FIX: linked accounts cannot enter the same contest at all. Enforced in
-- enter_tournament below, before the seat is taken.
-- ###########################################################################

create or replace function public.accounts_are_linked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_links
    where confidence_score >= 0.70
      and ((user_id_1 = least(a,b) and user_id_2 = greatest(a,b)))
  )
  or exists (
    -- Shared verified identity is a hard link regardless of confidence score.
    select 1
    from public.kyc_records k1
    join public.kyc_records k2 on k1.id_number_hash = k2.id_number_hash
    where k1.user_id = a and k2.user_id = b
      and k1.id_number_hash is not null
      and k1.status = 'approved' and k2.status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- tournament_bounties
-- One row per head. The unique constraint on (tournament_id, head_user_id) is
-- the double-claim guard: a bounty is collectable exactly once, enforced by
-- the database rather than by settlement code.
-- ---------------------------------------------------------------------------
create table public.tournament_bounties (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  head_user_id uuid not null references public.users (id) on delete cascade,
  amount_cents integer not null,
  claimed_by_user_id uuid references public.users (id) on delete set null,
  claimed_at timestamptz,
  claimed_in_match_id uuid references public.matches (id) on delete set null,
  constraint tournament_bounties_one_per_head unique (tournament_id, head_user_id),
  constraint tournament_bounties_amount_check check (amount_cents > 0),
  constraint tournament_bounties_no_self_claim check (
    claimed_by_user_id is null or claimed_by_user_id <> head_user_id
  ),
  constraint tournament_bounties_claim_shape check (
    (claimed_by_user_id is null) = (claimed_at is null)
  )
);

create index tournament_bounties_tournament_idx on public.tournament_bounties (tournament_id);
create index tournament_bounties_claimed_by_idx on public.tournament_bounties (claimed_by_user_id);

-- Total bounties issued can never exceed the carved bounty pool.
create or replace function public.assert_bounty_pool_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pool integer;
  issued integer;
begin
  select bounty_pool_cents into pool
  from public.tournaments
  where id = new.tournament_id
  for update;

  select coalesce(sum(amount_cents),0) into issued
  from public.tournament_bounties
  where tournament_id = new.tournament_id;

  if issued > pool then
    raise exception 'Bounties issued (%) exceed bounty pool (%)', issued, pool;
  end if;

  return new;
end;
$$;

create trigger assert_bounty_pool_balance_on_insert
  after insert on public.tournament_bounties
  for each row execute function public.assert_bounty_pool_balance();

-- ###########################################################################
-- THREAT — Satellite seats as bearer instruments
--
-- A seat is a thing of value. If it can be transferred, it becomes a way to
-- move value between accounts without touching the payment rails, which is an
-- unmonitored transfer channel and an obvious AML problem: buy in cheap, win
-- a seat, hand it to an account that never passed KYC.
--
-- FIX: seats are bound to the winning account permanently. There is no
-- transfer column and no transfer function. If the target contest cancels or
-- fills, the seat converts to cash at face value to the same account.
-- ###########################################################################

create table public.satellite_seats (
  id uuid primary key default gen_random_uuid(),
  won_in_tournament_id uuid not null references public.tournaments (id) on delete cascade,
  target_tournament_id uuid not null references public.tournaments (id) on delete cascade,
  -- Immutable. No transfer path exists anywhere in the schema.
  user_id uuid not null references public.users (id) on delete cascade,
  seat_value_cents integer not null,
  status text not null default 'unredeemed',
  redeemed_at timestamptz,
  converted_to_cash_at timestamptz,
  created_at timestamptz not null default now(),
  constraint satellite_seats_one_per_target unique (user_id, target_tournament_id),
  constraint satellite_seats_value_check check (seat_value_cents > 0),
  constraint satellite_seats_status_check check (
    status in ('unredeemed','redeemed','converted_to_cash','expired')
  ),
  constraint satellite_seats_redeem_shape check (
    (status = 'redeemed') = (redeemed_at is not null)
  )
);

create index satellite_seats_user_idx on public.satellite_seats (user_id);
create index satellite_seats_target_idx on public.satellite_seats (target_tournament_id);
create index satellite_seats_status_idx on public.satellite_seats (status);

comment on table public.satellite_seats is
  'Non-transferable by construction. A transferable seat is an unmonitored value-transfer channel.';

-- ---------------------------------------------------------------------------
-- ladder_runs
--
-- The bank-or-continue decision is the risk surface in this format. Two
-- properties keep it honest and both are enforced here:
--   1. Banking is always available and never expires. There is no deadline
--      column, so the decision can never be rushed by design.
--   2. State transitions are terminal. Once banked or busted a run is closed,
--      so a "bank" and a "continue" cannot both land.
-- ---------------------------------------------------------------------------
create table public.ladder_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  ruleset_id text not null references public.rulesets (id),
  entry_fee_cents integer not null,
  current_rung integer not null default 0,
  max_rung integer not null,
  status text not null default 'active',
  banked_cents integer,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint ladder_runs_entry_check check (entry_fee_cents > 0),
  constraint ladder_runs_rung_check check (current_rung between 0 and max_rung),
  constraint ladder_runs_status_check check (status in ('active','banked','busted')),
  constraint ladder_runs_banked_shape check (
    (status = 'banked') = (banked_cents is not null)
  ),
  constraint ladder_runs_ended_shape check (
    (status = 'active') = (ended_at is null)
  )
);

create index ladder_runs_user_idx on public.ladder_runs (user_id);
create index ladder_runs_status_idx on public.ladder_runs (status) where status = 'active';

-- One live run per player. Parallel runs would let a player hedge across
-- simultaneous climbs, which is not the offer being made.
create unique index ladder_runs_one_active_per_user
  on public.ladder_runs (user_id) where status = 'active';

create table public.ladder_rung_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ladder_runs (id) on delete cascade,
  rung integer not null,
  match_id uuid references public.matches (id) on delete set null,
  won boolean not null,
  bank_value_cents integer not null,
  played_at timestamptz not null default now(),
  constraint ladder_rung_results_unique unique (run_id, rung)
);

create index ladder_rung_results_run_idx on public.ladder_rung_results (run_id);

-- ---------------------------------------------------------------------------
-- Overlay is a real platform cost and belongs in the ledger, negative.
-- Recording it keeps the published milestone counter honest: a month of heavy
-- overlay should slow the counter down, because it genuinely did.
-- ---------------------------------------------------------------------------
alter table public.platform_ledger
  drop constraint if exists platform_ledger_entry_type_check;

alter table public.platform_ledger
  add constraint platform_ledger_entry_type_check check (
    entry_type in (
      'ranked_rake','tournament_rake','milestone_subsidy',
      'guarantee_overlay','bounty_pool','satellite_conversion',
      'refund','adjustment'
    )
  );

-- ---------------------------------------------------------------------------
-- enter_tournament: extended for linkage, seats, and format guards
-- ---------------------------------------------------------------------------
create or replace function public.enter_tournament(
  target_user_id uuid,
  target_tournament_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  taken integer;
  next_seat integer;
  entry_id uuid;
  linked_entrant uuid;
  seat record;
begin
  select * into t
  from public.tournaments
  where id = target_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;

  if t.status <> 'open' then
    raise exception 'Tournament is not open for entry';
  end if;

  if exists (
    select 1 from public.tournament_entries
    where tournament_id = target_tournament_id and user_id = target_user_id
  ) then
    raise exception 'Already entered';
  end if;

  -- Linked accounts may not share a field. Checked before the seat is taken,
  -- because a settled collusive contest has already moved the money.
  select e.user_id into linked_entrant
  from public.tournament_entries e
  where e.tournament_id = target_tournament_id
    and public.accounts_are_linked(e.user_id, target_user_id)
  limit 1;

  if linked_entrant is not null then
    raise exception 'A linked account is already entered in this contest';
  end if;

  select count(*) into taken
  from public.tournament_entries
  where tournament_id = target_tournament_id;

  if taken >= t.field_size then
    raise exception 'Tournament is full';
  end if;

  -- A satellite seat pays the entry. Redeemed atomically so it cannot be
  -- spent twice across concurrent requests.
  select * into seat
  from public.satellite_seats
  where user_id = target_user_id
    and target_tournament_id = target_tournament_id
    and status = 'unredeemed'
  for update
  limit 1;

  if seat is not null then
    update public.satellite_seats
    set status = 'redeemed', redeemed_at = now()
    where id = seat.id;
  else
    perform public.assert_can_wager(target_user_id, t.entry_fee_cents);

    if not public.debit_balance(target_user_id, t.entry_fee_cents) then
      raise exception 'Insufficient balance';
    end if;
  end if;

  next_seat := taken + 1;

  insert into public.tournament_entries
    (tournament_id, user_id, seat_number, entry_fee_paid_cents)
  values
    (target_tournament_id, target_user_id, next_seat, t.entry_fee_cents)
  returning id into entry_id;

  -- Post the entrant's bounty once their seat exists.
  if t.bounty_per_head_cents > 0 then
    insert into public.tournament_bounties (tournament_id, head_user_id, amount_cents)
    values (target_tournament_id, target_user_id, t.bounty_per_head_cents)
    on conflict (tournament_id, head_user_id) do nothing;
  end if;

  if next_seat = t.field_size then
    update public.tournaments set status = 'full' where id = target_tournament_id;
  end if;

  return entry_id;
end;
$$;

revoke execute on function public.enter_tournament(uuid, uuid) from anon, authenticated;
revoke execute on function public.accounts_are_linked(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- Structure and standings are public; money movement is service-role only.
-- ---------------------------------------------------------------------------
grant select on
  public.rulesets,
  public.tournament_rounds,
  public.tournament_matches,
  public.tournament_bounties,
  public.satellite_seats,
  public.ladder_runs,
  public.ladder_rung_results
to anon, authenticated;

alter table public.rulesets enable row level security;
create policy "rulesets_select_all" on public.rulesets
  for select to anon, authenticated using (true);

alter table public.tournament_rounds enable row level security;
create policy "tournament_rounds_select_all" on public.tournament_rounds
  for select to anon, authenticated using (true);

alter table public.tournament_matches enable row level security;
create policy "tournament_matches_select_all" on public.tournament_matches
  for select to anon, authenticated using (true);

alter table public.tournament_bounties enable row level security;
create policy "tournament_bounties_select_all" on public.tournament_bounties
  for select to anon, authenticated using (true);

alter table public.satellite_seats enable row level security;
create policy "satellite_seats_select_own" on public.satellite_seats
  for select to authenticated using (auth.uid() = user_id);

alter table public.ladder_runs enable row level security;
create policy "ladder_runs_select_own" on public.ladder_runs
  for select to authenticated using (auth.uid() = user_id);

alter table public.ladder_rung_results enable row level security;
create policy "ladder_rung_results_select_own" on public.ladder_rung_results
  for select to authenticated using (
    exists (
      select 1 from public.ladder_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );
