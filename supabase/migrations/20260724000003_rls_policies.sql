-- =============================================================================
-- Migration: Row Level Security policies for Grid Clash
-- =============================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.users,
  public.device_fingerprints,
  public.phone_verifications,
  public.kyc_records,
  public.matches,
  public.match_replays,
  public.transactions,
  public.withdrawal_addresses,
  public.playthrough_progress
to authenticated;

grant select on public.users to anon;

-- ---------------------------------------------------------------------------
-- users
-- Users can read their own profile. Public profiles are read-only stats.
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

create policy "users_select_own"
  on public.users for select
  to authenticated
  using (auth.uid() = id);

create policy "users_select_public_stats"
  on public.users for select
  to authenticated, anon
  using (true);

-- ---------------------------------------------------------------------------
-- device_fingerprints
-- Users can only manage their own device fingerprints.
-- Server actions (fraud detection) use service-role.
-- ---------------------------------------------------------------------------
alter table public.device_fingerprints enable row level security;

create policy "device_fingerprints_select_own"
  on public.device_fingerprints for select
  to authenticated
  using (auth.uid() = user_id);

create policy "device_fingerprints_insert_own"
  on public.device_fingerprints for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- phone_verifications
-- Users can view their own verification state.
-- Updates only via service-role (secure verification functions).
-- ---------------------------------------------------------------------------
alter table public.phone_verifications enable row level security;

create policy "phone_verifications_select_own"
  on public.phone_verifications for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- kyc_records
-- Users can view their own KYC status.
-- Created/updated only via service-role (Stripe Identity webhook).
-- ---------------------------------------------------------------------------
alter table public.kyc_records enable row level security;

create policy "kyc_records_select_own"
  on public.kyc_records for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- account_links
-- Not readable by users. Internal fraud detection only.
-- ---------------------------------------------------------------------------
alter table public.account_links enable row level security;

create policy "account_links_deny_all"
  on public.account_links for all
  to authenticated, anon
  using (false);

-- ---------------------------------------------------------------------------
-- matches
-- Users can read all match results (public leaderboard data).
-- Match creation is server-authoritative (service-role only).
-- ---------------------------------------------------------------------------
alter table public.matches enable row level security;

create policy "matches_select_all"
  on public.matches for select
  to authenticated, anon
  using (true);

-- ---------------------------------------------------------------------------
-- match_replays
-- Users can read their own match replays (for dispute/learning).
-- Public anonymized replays can be read by anyone (optional).
-- ---------------------------------------------------------------------------
alter table public.match_replays enable row level security;

create policy "match_replays_select_own"
  on public.match_replays for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- transactions
-- Users can read their own transaction history.
-- All mutations are service-role (webhook handlers, payout engine).
-- ---------------------------------------------------------------------------
alter table public.transactions enable row level security;

create policy "transactions_select_own"
  on public.transactions for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- withdrawal_addresses
-- Users can manage their own whitelist.
-- ---------------------------------------------------------------------------
alter table public.withdrawal_addresses enable row level security;

create policy "withdrawal_addresses_select_own"
  on public.withdrawal_addresses for select
  to authenticated
  using (auth.uid() = user_id);

create policy "withdrawal_addresses_insert_own"
  on public.withdrawal_addresses for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- playthrough_progress
-- Users can read their own playthrough state.
-- Updates only via service-role (match payout calculation).
-- ---------------------------------------------------------------------------
alter table public.playthrough_progress enable row level security;

create policy "playthrough_progress_select_own"
  on public.playthrough_progress for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- fraud_flags, ip_blocks, payment_method_blocks, elo_ratings_history
-- Not readable by users. Internal admin/system use only.
-- ---------------------------------------------------------------------------
alter table public.fraud_flags enable row level security;
create policy "fraud_flags_deny_all"
  on public.fraud_flags for all
  to authenticated, anon
  using (false);

alter table public.ip_blocks enable row level security;
create policy "ip_blocks_deny_all"
  on public.ip_blocks for all
  to authenticated, anon
  using (false);

alter table public.payment_method_blocks enable row level security;
create policy "payment_method_blocks_deny_all"
  on public.payment_method_blocks for all
  to authenticated, anon
  using (false);

alter table public.elo_ratings_history enable row level security;
create policy "elo_ratings_history_select_own"
  on public.elo_ratings_history for select
  to authenticated
  using (auth.uid() = user_id);
