-- =============================================================================
-- Migration: Grid Clash - Core schema with integrated fraud prevention
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users: Core user profile with KYC and phone verification state
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  email text not null,
  balance_cents integer not null default 0,
  elo_rating integer not null default 1600,
  lifetime_deposits_cents integer not null default 0,
  lifetime_winnings_cents integer not null default 0,
  matches_played integer not null default 0,
  matches_won integer not null default 0,
  phone_verified boolean not null default false,
  phone_number text,
  kyc_verified boolean not null default false,
  kyc_verified_at timestamptz,
  kyc_provider_user_id text,
  kyc_country text,
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_balance_check check (balance_cents >= 0),
  constraint users_elo_check check (elo_rating between 400 and 3200),
  constraint users_matches_won_check check (matches_won <= matches_played),
  constraint users_account_status_check check (account_status in ('active', 'suspended', 'banned', 'kyc_pending', 'phone_pending'))
);

create unique index users_username_lower_idx on public.users (lower(username));
create index users_elo_rating_idx on public.users (elo_rating desc);
create index users_kyc_verified_idx on public.users (kyc_verified);
create index users_phone_verified_idx on public.users (phone_verified);
create index users_created_at_idx on public.users (created_at desc);

-- ---------------------------------------------------------------------------
-- device_fingerprints: Track devices per user for fraud detection
-- One fingerprint per (user_id, device_id) pair.
-- TLS fingerprint, WebGL, canvas fingerprinting, etc. hashed server-side.
-- ---------------------------------------------------------------------------
create table public.device_fingerprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  fingerprint_hash text not null,
  user_agent text not null,
  ip_address inet not null,
  timezone text,
  language text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_primary boolean not null default false,
  constraint device_fingerprints_one_per_user_per_fp unique (user_id, fingerprint_hash)
);

create index device_fingerprints_user_id_idx on public.device_fingerprints (user_id);
create index device_fingerprints_fingerprint_hash_idx on public.device_fingerprints (fingerprint_hash);
create index device_fingerprints_ip_address_idx on public.device_fingerprints (ip_address);

-- ---------------------------------------------------------------------------
-- phone_verifications: SMS OTP tracking
-- One row per verification attempt. Tracks failures for rate limiting.
-- ---------------------------------------------------------------------------
create table public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  phone_number text not null,
  carrier_name text,
  is_voip boolean not null default false,
  phone_age_days integer,
  verification_attempts integer not null default 0,
  last_attempt_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint phone_verifications_attempts_check check (verification_attempts <= 5)
);

create index phone_verifications_user_id_idx on public.phone_verifications (user_id);
create index phone_verifications_verified_at_idx on public.phone_verifications (verified_at);

-- ---------------------------------------------------------------------------
-- kyc_records: KYC verification (Stripe Identity)
-- ---------------------------------------------------------------------------
create table public.kyc_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null,
  provider_verification_id text not null,
  status text not null,
  full_name text,
  date_of_birth date,
  country_code text,
  id_type text,
  id_number_hash text,
  sanction_check_passed boolean,
  sanction_check_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint kyc_records_status_check check (status in ('pending', 'approved', 'rejected', 'expired'))
);

create unique index kyc_records_provider_verification_idx on public.kyc_records (provider, provider_verification_id);
create index kyc_records_user_id_idx on public.kyc_records (user_id);
create index kyc_records_status_idx on public.kyc_records (status);

-- ---------------------------------------------------------------------------
-- account_links: Detect collusion/multi-accounting
-- Links accounts by payment method, phone, email domain, device, address.
-- Automatic; populated by trigger or service-role job.
-- ---------------------------------------------------------------------------
create table public.account_links (
  id uuid primary key default gen_random_uuid(),
  user_id_1 uuid not null references public.users (id) on delete cascade,
  user_id_2 uuid not null references public.users (id) on delete cascade,
  link_type text not null,
  confidence_score numeric(3, 2) not null,
  flagged_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_action text,
  constraint account_links_users_order check (user_id_1 < user_id_2),
  constraint account_links_type_check check (link_type in ('device', 'ip', 'payment_method', 'phone', 'email_domain', 'address_zip', 'creation_time')),
  constraint account_links_confidence_check check (confidence_score between 0 and 1)
);

create index account_links_user_id_1_idx on public.account_links (user_id_1);
create index account_links_user_id_2_idx on public.account_links (user_id_2);
create index account_links_confidence_idx on public.account_links (confidence_score desc);

-- ---------------------------------------------------------------------------
-- matches: Game results, server-authoritative
-- ---------------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_1_id uuid not null references public.users (id) on delete cascade,
  player_2_id uuid not null references public.users (id) on delete cascade,
  winner_id uuid not null references public.users (id) on delete cascade,
  loser_id uuid not null references public.users (id) on delete cascade,
  entry_fee_cents integer not null,
  winner_payout_cents integer not null,
  loser_payout_cents integer not null default 0,
  platform_rake_cents integer not null,
  ranked boolean not null default true,
  elo_change_winner integer,
  elo_change_loser integer,
  duration_seconds integer,
  reported boolean not null default false,
  dispute_resolution text,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint matches_winner_loser_check check (winner_id != loser_id),
  constraint matches_players_check check (
    (player_1_id = winner_id and player_2_id = loser_id) or
    (player_1_id = loser_id and player_2_id = winner_id)
  ),
  constraint matches_entry_fee_check check (entry_fee_cents > 0),
  constraint matches_payout_check check (winner_payout_cents >= 0 and loser_payout_cents >= 0)
);

create index matches_winner_id_idx on public.matches (winner_id);
create index matches_loser_id_idx on public.matches (loser_id);
create index matches_player_1_id_idx on public.matches (player_1_id);
create index matches_player_2_id_idx on public.matches (player_2_id);
create index matches_created_at_idx on public.matches (created_at desc);
create index matches_ranked_idx on public.matches (ranked);

-- ---------------------------------------------------------------------------
-- match_replays: Full game state for dispute resolution and behavioral analysis
-- Stores JSON: move sequence, timestamps, piece usage, etc.
-- ---------------------------------------------------------------------------
create table public.match_replays (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches (id) on delete cascade,
  replay_data jsonb not null,
  move_sequence text[],
  player_1_timings integer[],
  player_2_timings integer[],
  created_at timestamptz not null default now()
);

create index match_replays_match_id_idx on public.match_replays (match_id);

-- ---------------------------------------------------------------------------
-- transactions: Deposits and withdrawals with 7-day hold logic
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null,
  amount_cents integer not null,
  status text not null default 'pending',
  payment_provider text,
  provider_transaction_id text,
  hold_until_at timestamptz,
  is_bonus boolean not null default false,
  bonus_playthrough_required_cents integer,
  bonus_playthrough_completed_cents integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint transactions_type_check check (type in ('deposit', 'withdrawal', 'match_payout', 'bonus', 'refund', 'chargeback_claw')),
  constraint transactions_status_check check (status in ('pending', 'completed', 'failed', 'on_hold', 'cancelled')),
  constraint transactions_amount_check check (amount_cents > 0)
);

create index transactions_user_id_idx on public.transactions (user_id);
create index transactions_type_idx on public.transactions (type);
create index transactions_status_idx on public.transactions (status);
create index transactions_created_at_idx on public.transactions (created_at desc);
create index transactions_hold_until_at_idx on public.transactions (hold_until_at);

-- ---------------------------------------------------------------------------
-- withdrawal_addresses: Whitelist per user
-- First withdrawal establishes the address. Subsequent to different address = KYC re-verify.
-- ---------------------------------------------------------------------------
create table public.withdrawal_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  address text not null,
  address_type text not null,
  is_primary boolean not null default false,
  kyc_verified boolean not null default false,
  added_at timestamptz not null default now(),
  constraint withdrawal_addresses_type_check check (address_type in ('stripe_connected_account', 'bank_account', 'wallet'))
);

create index withdrawal_addresses_user_id_idx on public.withdrawal_addresses (user_id);
create index withdrawal_addresses_is_primary_idx on public.withdrawal_addresses (is_primary);

-- ---------------------------------------------------------------------------
-- fraud_flags: Behavioral and rule-based fraud signals
-- Populated by triggers and scheduled detection jobs.
-- ---------------------------------------------------------------------------
create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  flag_type text not null,
  severity text not null,
  reason text,
  triggered_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_action text,
  constraint fraud_flags_severity_check check (severity in ('low', 'medium', 'high', 'critical'))
);

create index fraud_flags_user_id_idx on public.fraud_flags (user_id);
create index fraud_flags_severity_idx on public.fraud_flags (severity);
create index fraud_flags_triggered_at_idx on public.fraud_flags (triggered_at desc);

-- ---------------------------------------------------------------------------
-- playthrough_progress: Track bonus playthrough per transaction
-- 1.5x playthrough required; only matches vs accounts > 7 days old, Elo diff > 100.
-- ---------------------------------------------------------------------------
create table public.playthrough_progress (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  required_playthrough_cents integer not null,
  completed_playthrough_cents integer not null default 0,
  qualifying_matches integer not null default 0,
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint playthrough_progress_cents_check check (
    completed_playthrough_cents <= required_playthrough_cents
  )
);

create index playthrough_progress_user_id_idx on public.playthrough_progress (user_id);
create index playthrough_progress_expires_at_idx on public.playthrough_progress (expires_at);

-- ---------------------------------------------------------------------------
-- elo_ratings_history: Track Elo changes over time
-- ---------------------------------------------------------------------------
create table public.elo_ratings_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  elo_before integer not null,
  elo_after integer not null,
  change integer not null,
  created_at timestamptz not null default now()
);

create index elo_ratings_history_user_id_idx on public.elo_ratings_history (user_id);
create index elo_ratings_history_created_at_idx on public.elo_ratings_history (created_at desc);

-- ---------------------------------------------------------------------------
-- ip_blocks: Hardban list
-- ---------------------------------------------------------------------------
create table public.ip_blocks (
  id uuid primary key default gen_random_uuid(),
  ip_address inet not null unique,
  reason text,
  added_at timestamptz not null default now(),
  expires_at timestamptz
);

create index ip_blocks_ip_address_idx on public.ip_blocks (ip_address);
create index ip_blocks_expires_at_idx on public.ip_blocks (expires_at);

-- ---------------------------------------------------------------------------
-- payment_method_blocks: Block stolen cards, etc.
-- ---------------------------------------------------------------------------
create table public.payment_method_blocks (
  id uuid primary key default gen_random_uuid(),
  payment_method_hash text not null unique,
  reason text,
  added_at timestamptz not null default now(),
  expires_at timestamptz
);

create index payment_method_blocks_expires_at_idx on public.payment_method_blocks (expires_at);
