-- =============================================================================
-- Migration: Responsible gaming controls and jurisdiction gating
--
-- Required to operate paid-entry skill contests in most US states and in the
-- EU/UK. These are licensing preconditions, not optional product polish: an
-- operator without deposit limits, self-exclusion, and geo-restriction is
-- unlicensed rather than lightly non-compliant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- player_limits
-- Player-set caps. Loosening a limit takes effect only after a cooling-off
-- period (enforced by pending_* columns); tightening applies immediately.
-- That asymmetry is the entire point — a limit a player can lift mid-session
-- is not a limit.
-- ---------------------------------------------------------------------------
create table public.player_limits (
  user_id uuid primary key references public.users (id) on delete cascade,

  daily_deposit_limit_cents integer,
  weekly_deposit_limit_cents integer,
  monthly_deposit_limit_cents integer,

  daily_loss_limit_cents integer,
  weekly_loss_limit_cents integer,

  session_duration_limit_minutes integer,

  -- Staged increases. Applied by a scheduled job once effective_at passes.
  pending_daily_deposit_limit_cents integer,
  pending_weekly_deposit_limit_cents integer,
  pending_monthly_deposit_limit_cents integer,
  pending_daily_loss_limit_cents integer,
  pending_weekly_loss_limit_cents integer,
  pending_effective_at timestamptz,

  updated_at timestamptz not null default now(),

  constraint player_limits_daily_deposit_check check (daily_deposit_limit_cents is null or daily_deposit_limit_cents > 0),
  constraint player_limits_weekly_deposit_check check (weekly_deposit_limit_cents is null or weekly_deposit_limit_cents > 0),
  constraint player_limits_monthly_deposit_check check (monthly_deposit_limit_cents is null or monthly_deposit_limit_cents > 0),
  constraint player_limits_daily_loss_check check (daily_loss_limit_cents is null or daily_loss_limit_cents > 0),
  constraint player_limits_weekly_loss_check check (weekly_loss_limit_cents is null or weekly_loss_limit_cents > 0),
  constraint player_limits_session_check check (session_duration_limit_minutes is null or session_duration_limit_minutes > 0)
);

comment on table public.player_limits is
  'Player-configured caps. Tightening is immediate; loosening is staged behind pending_effective_at.';

-- ---------------------------------------------------------------------------
-- self_exclusions
-- A self-exclusion is irrevocable for its duration. There is deliberately no
-- update or delete policy and no early-release column: the record can only be
-- outlived, never lifted. Permanent exclusions have expires_at null.
-- ---------------------------------------------------------------------------
create table public.self_exclusions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  is_permanent boolean not null default false,
  reason text,
  constraint self_exclusions_permanent_has_no_expiry check (
    (is_permanent and expires_at is null) or (not is_permanent and expires_at is not null)
  )
);

create index self_exclusions_user_id_idx on public.self_exclusions (user_id);
create index self_exclusions_expires_at_idx on public.self_exclusions (expires_at);

comment on table public.self_exclusions is
  'Irrevocable for the stated duration. No mechanism exists to lift one early, by design.';

-- ---------------------------------------------------------------------------
-- play_sessions
-- Drives elapsed-time and net-loss reality checks during play.
-- ---------------------------------------------------------------------------
create table public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  matches_played integer not null default 0,
  net_result_cents integer not null default 0,
  last_reality_check_at timestamptz,
  reality_checks_shown integer not null default 0
);

create index play_sessions_user_id_idx on public.play_sessions (user_id);
create index play_sessions_started_at_idx on public.play_sessions (started_at desc);
create index play_sessions_active_idx on public.play_sessions (user_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- jurisdiction_rules
-- Paid-entry skill contests are prohibited or separately licensed in a number
-- of US states. Populated by the operator from current legal advice; the
-- application reads it and refuses stakes play where allowed is false.
--
-- Seeded below with the states that most commonly prohibit paid-entry contests
-- of this shape. This seed is a starting point for counsel to correct, not
-- legal advice, and it must be reviewed before launch.
-- ---------------------------------------------------------------------------
create table public.jurisdiction_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  region_code text,
  paid_entry_allowed boolean not null,
  free_play_allowed boolean not null default true,
  minimum_age integer not null default 18,
  notes text,
  updated_at timestamptz not null default now(),
  constraint jurisdiction_rules_unique_region unique (country_code, region_code)
);

create index jurisdiction_rules_country_idx on public.jurisdiction_rules (country_code);

insert into public.jurisdiction_rules (country_code, region_code, paid_entry_allowed, minimum_age, notes) values
  ('US', null, true,  18, 'Default for US states not listed. Review per state before launch.'),
  ('US', 'AZ', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'AR', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'CT', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'DE', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'LA', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'MT', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'SD', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'TN', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'WA', false, 18, 'Broad prohibition on online contests for value. Confirm with counsel.'),
  ('US', 'ID', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'IA', true,  21, 'Higher minimum age. Confirm current status with counsel.'),
  ('US', 'MA', true,  21, 'Higher minimum age. Confirm current status with counsel.'),
  ('US', 'AL', true,  19, 'Higher minimum age. Confirm current status with counsel.'),
  ('US', 'NE', true,  19, 'Higher minimum age. Confirm current status with counsel.')
on conflict (country_code, region_code) do nothing;

-- ---------------------------------------------------------------------------
-- deposit_velocity: rolling aggregates used to enforce player_limits without
-- a full table scan of transactions on every deposit attempt.
-- ---------------------------------------------------------------------------
create table public.deposit_velocity (
  user_id uuid not null references public.users (id) on delete cascade,
  window_date date not null,
  deposited_cents integer not null default 0,
  net_loss_cents integer not null default 0,
  primary key (user_id, window_date)
);

create index deposit_velocity_window_date_idx on public.deposit_velocity (window_date);

-- ---------------------------------------------------------------------------
-- is_self_excluded: single source of truth, used by deposit and match-entry
-- guards alike so the two can never disagree about a player's status.
-- ---------------------------------------------------------------------------
create or replace function public.is_self_excluded(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.self_exclusions
    where user_id = target_user_id
      and (is_permanent or expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- Players read and set their own limits and exclusions. Enforcement happens
-- server-side under the service role; these policies exist so the settings UI
-- can function, not so the client can be trusted.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.player_limits to authenticated;
grant select, insert on public.self_exclusions to authenticated;
grant select on public.play_sessions to authenticated;
grant select on public.jurisdiction_rules to anon, authenticated;

alter table public.player_limits enable row level security;

create policy "player_limits_select_own"
  on public.player_limits for select
  to authenticated
  using (auth.uid() = user_id);

create policy "player_limits_insert_own"
  on public.player_limits for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "player_limits_update_own"
  on public.player_limits for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.self_exclusions enable row level security;

create policy "self_exclusions_select_own"
  on public.self_exclusions for select
  to authenticated
  using (auth.uid() = user_id);

-- Insert only. No update or delete policy exists for any role: an exclusion
-- cannot be shortened or removed through the API.
create policy "self_exclusions_insert_own"
  on public.self_exclusions for insert
  to authenticated
  with check (auth.uid() = user_id);

alter table public.play_sessions enable row level security;

create policy "play_sessions_select_own"
  on public.play_sessions for select
  to authenticated
  using (auth.uid() = user_id);

alter table public.jurisdiction_rules enable row level security;

create policy "jurisdiction_rules_select_all"
  on public.jurisdiction_rules for select
  to anon, authenticated
  using (true);

alter table public.deposit_velocity enable row level security;

create policy "deposit_velocity_select_own"
  on public.deposit_velocity for select
  to authenticated
  using (auth.uid() = user_id);

create trigger set_player_limits_updated_at
  before update on public.player_limits
  for each row execute function public.set_updated_at();
