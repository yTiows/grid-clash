-- =============================================================================
-- Migration: Reputation, rewards, and standing
--
-- Mirrors src/lib/game/reputation.ts. Scores are computed server-side and
-- stored; the formulas are published, so storing rather than recomputing on
-- read costs nothing in transparency and saves a great deal at query time.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- player_standing
-- One row per player. Denormalised because every one of these is read on
-- almost every page and recomputing a Skill Index per request would be
-- gratuitous.
-- ---------------------------------------------------------------------------
create table public.player_standing (
  user_id uuid primary key references public.users (id) on delete cascade,

  skill_index integer not null default 0,
  si_rating integer not null default 0,
  si_opposition integer not null default 0,
  si_consistency integer not null default 0,
  si_volume integer not null default 0,
  si_fair_play integer not null default 0,
  skill_index_percentile numeric(5,2),

  confidence numeric(4,3) not null default 0,
  is_provisional boolean not null default true,

  trust_score integer not null default 0,
  trust_band text not null default 'new',

  fee_tier text not null default 'standard',

  distinct_opponents integer not null default 0,
  average_opponent_elo integer,
  performance_std_dev numeric(5,4),
  upheld_fair_play_findings integer not null default 0,

  computed_at timestamptz not null default now(),

  constraint player_standing_skill_index_range check (skill_index between 0 and 10000),
  constraint player_standing_confidence_range check (confidence between 0 and 1),
  constraint player_standing_trust_range check (trust_score between 0 and 100),
  constraint player_standing_band_check check (
    trust_band in ('new','building','trusted','veteran')
  ),
  constraint player_standing_fee_tier_check check (
    fee_tier in ('standard','established','elite')
  ),
  constraint player_standing_percentile_range check (
    skill_index_percentile is null or skill_index_percentile between 0 and 100
  ),
  -- Components must sum to the total, or the published breakdown is a lie.
  constraint player_standing_components_sum check (
    skill_index = si_rating + si_opposition + si_consistency + si_volume + si_fair_play
  )
);

create index player_standing_skill_index_idx on public.player_standing (skill_index desc);
create index player_standing_fee_tier_idx on public.player_standing (fee_tier);
create index player_standing_provisional_idx on public.player_standing (is_provisional);

comment on table public.player_standing is
  'Computed standing. Every formula is published in-product; see reputation.ts.';

-- ---------------------------------------------------------------------------
-- automation_reviews
--
-- Bot suspicion feeds a review queue that can freeze an account. It never
-- awards anything.
--
-- Signal values are stored for investigator context but are NOT exposed
-- through any policy: publishing thresholds writes the evasion guide.
--
-- Freezing suspends play but does NOT seize funds. An account frozen in error
-- must be able to withdraw its own money once cleared, and treating suspicion
-- as forfeiture would be indefensible.
-- ---------------------------------------------------------------------------
create table public.automation_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  suspicion_score integer not null,
  action text not null,
  latency_std_dev_ms numeric(8,2),
  optimal_move_rate numeric(4,3),
  longest_session_hours numeric(5,2),
  active_hours_spread integer,
  matches_sampled integer not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  reviewer_note text,
  constraint automation_reviews_score_range check (suspicion_score between 0 and 100),
  constraint automation_reviews_action_check check (
    action in ('none','monitor','review','freeze')
  ),
  constraint automation_reviews_resolution_check check (
    resolution is null or resolution in ('cleared','confirmed_automation','inconclusive')
  ),
  constraint automation_reviews_resolved_shape check (
    (resolved_at is null) = (resolution is null)
  )
);

create index automation_reviews_user_idx on public.automation_reviews (user_id);
create index automation_reviews_open_idx on public.automation_reviews (action)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- automation_refunds
--
-- When automation is confirmed, the humans it beat are refunded. Without this
-- the platform keeps the fee on matches it has just declared fraudulent, which
-- would mean profiting from the cheating it detected.
-- ---------------------------------------------------------------------------
create table public.automation_refunds (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.automation_reviews (id) on delete cascade,
  victim_user_id uuid not null references public.users (id) on delete cascade,
  match_id uuid references public.matches (id) on delete set null,
  refund_cents integer not null,
  paid_at timestamptz,
  constraint automation_refunds_amount_check check (refund_cents > 0),
  constraint automation_refunds_one_per_match unique (review_id, match_id, victim_user_id)
);

create index automation_refunds_victim_idx on public.automation_refunds (victim_user_id);

-- ---------------------------------------------------------------------------
-- comeback_claims
--
-- Refunds one entry fee after ten played losses. The uniqueness of an open
-- claim plus the cooldown are what keep it from being farmed; the refund is
-- also bounded by the streak's own stakes in application code, so ten cheap
-- losses cannot fund an expensive seat.
-- ---------------------------------------------------------------------------
create table public.comeback_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  consecutive_losses integer not null,
  played_losses integer not null,
  refund_cents integer not null,
  median_stake_cents integer not null,
  claimed_at timestamptz not null default now(),
  constraint comeback_claims_streak_check check (consecutive_losses >= 10),
  -- Only matches played to completion count. Instant forfeits are cheap to
  -- manufacture and would otherwise make the refund farmable.
  constraint comeback_claims_played_check check (played_losses >= 10),
  constraint comeback_claims_refund_check check (
    refund_cents > 0 and refund_cents <= median_stake_cents
  )
);

create index comeback_claims_user_idx on public.comeback_claims (user_id, claimed_at desc);

-- Enforces the 7-day cooldown at the database rather than in a handler that
-- could be reached by another route.
create or replace function public.enforce_comeback_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  last_claim timestamptz;
begin
  select max(claimed_at) into last_claim
  from public.comeback_claims
  where user_id = new.user_id;

  if last_claim is not null and last_claim > now() - interval '7 days' then
    raise exception 'Comeback refund available once every 7 days';
  end if;

  return new;
end;
$$;

create trigger enforce_comeback_cooldown_on_claim
  before insert on public.comeback_claims
  for each row execute function public.enforce_comeback_cooldown();

-- ---------------------------------------------------------------------------
-- player_rewards
--
-- Non-monetary rewards. There is deliberately no price column, no transfer
-- column, and no grant-by-purchase path: a reward that can be bought is
-- pay-to-win the moment it touches gameplay, and every reward here is earned.
-- ---------------------------------------------------------------------------
create table public.player_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  reward_id text not null,
  kind text not null,
  earned_from_tournament_id uuid references public.tournaments (id) on delete set null,
  earned_at timestamptz not null default now(),
  expires_at timestamptz,
  consumed_at timestamptz,
  constraint player_rewards_kind_check check (
    kind in ('title','access','reserved_seat','challenge_right','host_right','flair','archive_entry')
  )
);

create index player_rewards_user_idx on public.player_rewards (user_id);
create index player_rewards_active_idx on public.player_rewards (user_id, reward_id)
  where consumed_at is null;

-- A reserved Daily Dollar seat is single-event and non-cumulative. Without
-- both, fifteen repeat winners would lock a fifteen-seat contest permanently
-- and no new player would ever get in.
create unique index player_rewards_one_active_reserved_seat
  on public.player_rewards (user_id, reward_id)
  where reward_id = 'reserved_dollar_seat' and consumed_at is null;

-- ---------------------------------------------------------------------------
-- challenge_rights / challenges
--
-- Challenges are opt-in on the recipient's side and decline carries no
-- penalty. An unlimited, unsolicited challenge channel pointed at top players
-- is a harassment vector, and those are the players the platform can least
-- afford to lose.
-- ---------------------------------------------------------------------------
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.users (id) on delete cascade,
  target_id uuid not null references public.users (id) on delete cascade,
  stake_cents integer not null,
  ruleset_id text not null references public.rulesets (id),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null,
  match_id uuid references public.matches (id) on delete set null,
  constraint challenges_distinct check (challenger_id <> target_id),
  constraint challenges_stake_check check (stake_cents > 0),
  constraint challenges_status_check check (
    status in ('pending','accepted','declined','expired','cancelled')
  )
);

create index challenges_target_idx on public.challenges (target_id, status);
create index challenges_challenger_idx on public.challenges (challenger_id);

-- Rate limit: one open challenge per pair. Prevents a single account from
-- flooding one player with requests.
create unique index challenges_one_open_per_pair
  on public.challenges (challenger_id, target_id)
  where status = 'pending';

create table public.challenge_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  accepts_challenges boolean not null default false,
  min_stake_cents integer,
  max_stake_cents integer,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- rivalries
--
-- Head-to-head records. The cheapest retention mechanic available: a 3-4
-- record against someone you remember is a reason to return that costs nothing
-- and manipulates no one.
-- ---------------------------------------------------------------------------
create table public.rivalries (
  user_id uuid not null references public.users (id) on delete cascade,
  opponent_id uuid not null references public.users (id) on delete cascade,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  net_cents integer not null default 0,
  last_played_at timestamptz not null default now(),
  primary key (user_id, opponent_id),
  constraint rivalries_distinct check (user_id <> opponent_id),
  constraint rivalries_counts_nonneg check (wins >= 0 and losses >= 0 and draws >= 0)
);

create index rivalries_user_idx on public.rivalries (user_id, last_played_at desc);

-- ---------------------------------------------------------------------------
-- personal_bests
--
-- net_profit_cents is stored here and is ALWAYS displayed, positive or
-- negative. Showing it only when favourable is the kind of selective honesty
-- that costs all remaining trust the first time a player notices.
-- ---------------------------------------------------------------------------
create table public.personal_bests (
  user_id uuid primary key references public.users (id) on delete cascade,
  longest_win_streak integer not null default 0,
  current_win_streak integer not null default 0,
  current_loss_streak integer not null default 0,
  highest_elo integer not null default 1600,
  biggest_upset_elo integer not null default 0,
  fastest_win_seconds integer,
  best_finish_place integer,
  total_matches integer not null default 0,
  net_profit_cents integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint personal_bests_streaks_nonneg check (
    longest_win_streak >= 0 and current_win_streak >= 0 and current_loss_streak >= 0
  )
);

-- ---------------------------------------------------------------------------
-- season_archive
-- Permanent. No delete path exists for any role.
-- ---------------------------------------------------------------------------
create table public.season_archive (
  id uuid primary key default gen_random_uuid(),
  season_id text not null,
  user_id uuid not null references public.users (id) on delete cascade,
  final_rank integer not null,
  final_skill_index integer not null,
  matches_played integer not null,
  archived_at timestamptz not null default now(),
  constraint season_archive_unique unique (season_id, user_id),
  constraint season_archive_rank_check check (final_rank > 0)
);

create index season_archive_season_idx on public.season_archive (season_id, final_rank);

-- ---------------------------------------------------------------------------
-- Public leaderboard projection
--
-- Skill only. Money is deliberately absent.
--
-- A public ranking of who has won the most money is a target list: it tells a
-- social engineer exactly whom to approach and tells a colluder exactly whose
-- table to sit at. Players see their own financial figures in full; nobody
-- else sees them at all.
-- ---------------------------------------------------------------------------
create view public.leaderboard
  with (security_invoker = false)
  as
  select
    u.id,
    u.username,
    u.elo_rating,
    u.matches_played,
    u.matches_won,
    s.skill_index,
    s.trust_band,
    s.is_provisional,
    t.tier as equipped_title_tier,
    rank() over (order by s.skill_index desc) as rank
  from public.users u
  join public.player_standing s on s.user_id = u.id
  left join public.player_titles t on t.user_id = u.id and t.is_equipped
  where u.account_status = 'active'
    and not s.is_provisional;

grant select on public.leaderboard to anon, authenticated;

comment on view public.leaderboard is
  'Skill only. Financial columns are intentionally excluded: a public money ranking is a target list.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
grant select on
  public.player_standing,
  public.player_rewards,
  public.rivalries,
  public.personal_bests,
  public.season_archive,
  public.challenges,
  public.challenge_preferences
to authenticated;

grant select on public.season_archive to anon;

alter table public.player_standing enable row level security;
create policy "player_standing_select_all" on public.player_standing
  for select to authenticated using (true);

alter table public.player_rewards enable row level security;
create policy "player_rewards_select_all" on public.player_rewards
  for select to authenticated using (true);

alter table public.rivalries enable row level security;
create policy "rivalries_select_own" on public.rivalries
  for select to authenticated using (auth.uid() = user_id);

-- Own bests only: net_profit_cents is financial and belongs to the player.
alter table public.personal_bests enable row level security;
create policy "personal_bests_select_own" on public.personal_bests
  for select to authenticated using (auth.uid() = user_id);

alter table public.season_archive enable row level security;
create policy "season_archive_select_all" on public.season_archive
  for select to anon, authenticated using (true);

alter table public.challenges enable row level security;
create policy "challenges_select_involved" on public.challenges
  for select to authenticated
  using (auth.uid() = challenger_id or auth.uid() = target_id);

alter table public.challenge_preferences enable row level security;
create policy "challenge_preferences_select_all" on public.challenge_preferences
  for select to authenticated using (true);
create policy "challenge_preferences_update_own" on public.challenge_preferences
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "challenge_preferences_insert_own" on public.challenge_preferences
  for insert to authenticated with check (auth.uid() = user_id);
grant insert, update on public.challenge_preferences to authenticated;

-- Investigation tables stay closed. Exposing thresholds writes the evasion
-- guide; exposing findings before resolution defames the accused.
alter table public.automation_reviews enable row level security;
create policy "automation_reviews_deny_all" on public.automation_reviews
  for all to anon, authenticated using (false);

alter table public.automation_refunds enable row level security;
create policy "automation_refunds_select_own" on public.automation_refunds
  for select to authenticated using (auth.uid() = victim_user_id);

alter table public.comeback_claims enable row level security;
create policy "comeback_claims_select_own" on public.comeback_claims
  for select to authenticated using (auth.uid() = user_id);

create trigger set_challenge_preferences_updated_at
  before update on public.challenge_preferences
  for each row execute function public.set_updated_at();
