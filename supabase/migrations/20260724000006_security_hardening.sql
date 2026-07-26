-- =============================================================================
-- Migration: Security hardening
--
-- Findings from an adversarial review of migrations 0001-0005. Ordered by
-- severity. Each fix states the attack it closes, because a control whose
-- threat model is undocumented gets deleted by the next engineer who finds it
-- inconvenient.
-- =============================================================================

-- ###########################################################################
-- FINDING 1 [CRITICAL] - Full PII disclosure to anonymous users.
--
-- 0003 created both `users_select_own` AND `users_select_public_stats`
-- (USING true, granted to anon). Postgres RLS policies are OR-ed, and RLS is
-- row-level, not column-level. The permissive policy therefore exposed every
-- column of every row to unauthenticated callers: email, phone_number,
-- balance_cents, kyc_country, kyc_provider_user_id, lifetime_deposits_cents.
--
-- Anyone with the public anon key — which ships in the browser bundle by
-- design — could have dumped the entire user table.
-- ###########################################################################

drop policy if exists "users_select_public_stats" on public.users;

revoke all on public.users from anon;
revoke insert, update, delete on public.users from authenticated;

-- Public-facing projection. Column allowlist, not a row filter: adding a
-- sensitive column to `users` later cannot silently widen this.
create or replace view public.public_players
  with (security_invoker = false)
  as
  select
    u.id,
    u.username,
    u.elo_rating,
    u.matches_played,
    u.matches_won,
    u.created_at,
    t.tier as equipped_title_tier
  from public.users u
  left join public.player_titles t
    on t.user_id = u.id and t.is_equipped
  where u.account_status = 'active';

grant select on public.public_players to anon, authenticated;

comment on view public.public_players is
  'The only user data reachable by anon. Never add email, phone, balance, or KYC columns here.';

-- ###########################################################################
-- FINDING 2 [CRITICAL] - Balance is a bare mutable scalar. Two live bugs:
--
--   a) Time-of-check-to-time-of-use. Any read-check-write sequence
--      (read balance -> verify >= fee -> write balance - fee) loses to
--      concurrency: N simultaneous entries all read the same starting balance,
--      all pass the check, and the user enters N contests having paid for one.
--      Fifty parallel withdrawal requests drain a balance fifty times.
--
--   b) No audit trail. A scalar cannot be reconstructed or reconciled. For a
--      system holding customer funds, an unauditable balance is not a bug you
--      find later — it is a bug you can never prove you do not have.
--
-- Fix: append-only entry log, and a single atomic function that is the ONLY
-- way balance moves. The conditional UPDATE ... WHERE balance >= amount makes
-- the check and the write one statement, so the race has nowhere to open.
-- ###########################################################################

create table public.balance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  -- Signed. Positive credits the player, negative debits.
  amount_cents integer not null,
  balance_after_cents integer not null,
  reason text not null,
  match_id uuid references public.matches (id) on delete set null,
  tournament_id uuid references public.tournaments (id) on delete set null,
  transaction_id uuid references public.transactions (id) on delete set null,
  -- Caller-supplied dedup key. Makes every money movement replay-safe.
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint balance_entries_nonzero check (amount_cents <> 0),
  constraint balance_entries_never_negative check (balance_after_cents >= 0),
  constraint balance_entries_reason_check check (
    reason in (
      'deposit', 'withdrawal', 'withdrawal_reversed',
      'ranked_entry', 'ranked_payout', 'ranked_refund',
      'tournament_entry', 'tournament_payout', 'tournament_refund',
      'chargeback', 'adjustment'
    )
  )
);

create unique index balance_entries_idempotency_key_uidx
  on public.balance_entries (idempotency_key);
create index balance_entries_user_id_idx on public.balance_entries (user_id, created_at desc);

alter table public.balance_entries enable row level security;
create policy "balance_entries_select_own"
  on public.balance_entries for select
  to authenticated
  using (auth.uid() = user_id);
grant select on public.balance_entries to authenticated;

comment on table public.balance_entries is
  'Append-only. users.balance_cents is a cache of sum(amount_cents); this table is the source of truth.';

-- The only sanctioned path for money movement.
--
-- Returns the new balance, or raises. Never returns a partial success: the
-- balance write and the ledger row are one statement each inside one
-- transaction, so a crash between them is impossible.
create or replace function public.move_balance(
  p_user_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_idempotency_key text,
  p_match_id uuid default null,
  p_tournament_id uuid default null,
  p_transaction_id uuid default null
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
    raise exception 'move_balance: amount must be non-zero';
  end if;

  -- Replay guard. A retried webhook or a double-clicked button returns the
  -- original outcome instead of moving money twice.
  select balance_after_cents into v_existing
  from public.balance_entries
  where idempotency_key = p_idempotency_key;

  if found then
    return v_existing;
  end if;

  -- Check and write in one statement. This is the whole defence against
  -- the TOCTOU race; splitting it reintroduces the bug.
  update public.users
  set balance_cents = balance_cents + p_amount_cents
  where id = p_user_id
    and balance_cents + p_amount_cents >= 0
  returning balance_cents into v_new_balance;

  if not found then
    raise exception 'move_balance: insufficient funds or unknown user'
      using errcode = 'check_violation';
  end if;

  insert into public.balance_entries (
    user_id, amount_cents, balance_after_cents, reason,
    match_id, tournament_id, transaction_id, idempotency_key
  ) values (
    p_user_id, p_amount_cents, v_new_balance, p_reason,
    p_match_id, p_tournament_id, p_transaction_id, p_idempotency_key
  );

  return v_new_balance;
end;
$$;

revoke all on function public.move_balance from public, anon, authenticated;

-- Reconciliation. Any drift between the cached balance and the ledger is a
-- bug that must surface loudly rather than accrue quietly.
create or replace function public.audit_balance_drift()
returns table (user_id uuid, cached_cents integer, ledger_cents bigint, drift_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.balance_cents,
    coalesce(sum(b.amount_cents), 0)::bigint,
    (u.balance_cents - coalesce(sum(b.amount_cents), 0))::bigint
  from public.users u
  left join public.balance_entries b on b.user_id = u.id
  group by u.id, u.balance_cents
  having u.balance_cents <> coalesce(sum(b.amount_cents), 0);
$$;

-- ###########################################################################
-- FINDING 3 [HIGH] - One person can capture an entire Milestone event.
--
-- A Milestone is +EV by construction: $100 entry, $1,515 to the winner across
-- a 15-seat field, so each seat is worth $101. That is intended generosity
-- toward players. But a field that small with positive EV is a standing
-- invitation: an attacker who takes all 15 seats with sockpuppets pays $1,500
-- and collects $1,515 no matter which puppet wins. Risk-free $15, and the
-- entire subsidy is captured by one person while real players see a full
-- lobby they could never join.
--
-- The Daily Dollar has the same shape at break-even rather than profit, so the
-- payoff is griefing and reputational damage rather than theft.
--
-- Fix: entry eligibility is scoped to a verified human, not to an account
-- row, and any two entrants already flagged as linked cannot share a field.
-- ###########################################################################

create table public.contest_eligibility_rules (
  kind text primary key,
  requires_kyc boolean not null default false,
  min_account_age_hours integer not null default 0,
  min_ranked_matches integer not null default 0,
  -- Blocks entry when another entrant is a known linked account.
  enforce_account_links boolean not null default true,
  max_link_confidence numeric(3, 2) not null default 0.60,
  constraint contest_eligibility_kind_check check (
    kind in ('ranked', 'tournament_standard', 'tournament_dollar', 'tournament_milestone')
  )
);

insert into public.contest_eligibility_rules
  (kind, requires_kyc, min_account_age_hours, min_ranked_matches, max_link_confidence)
values
  ('ranked',                false, 0,   0,  0.80),
  ('tournament_standard',   false, 24,  5,  0.70),
  -- Scarce, globally limited, and reputation-critical.
  ('tournament_dollar',     true,  72,  10, 0.50),
  -- Positive EV and house-subsidised. Strictest gate on the platform.
  ('tournament_milestone',  true,  168, 25, 0.40)
on conflict (kind) do nothing;

grant select on public.contest_eligibility_rules to authenticated;
alter table public.contest_eligibility_rules enable row level security;
create policy "contest_eligibility_rules_select_all"
  on public.contest_eligibility_rules for select
  to authenticated using (true);

-- Single decision point for "may this player enter this contest".
-- Both the join endpoint and the UI call it, so what the button says and what
-- the server does cannot disagree.
create or replace function public.check_contest_eligibility(
  p_user_id uuid,
  p_tournament_id uuid
)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_status text;
  v_rules public.contest_eligibility_rules%rowtype;
  v_user public.users%rowtype;
  v_ranked_matches integer;
  v_linked_entrants integer;
begin
  select t.kind, t.status into v_kind, v_status
  from public.tournaments t where t.id = p_tournament_id;

  if not found then
    return query select false, 'Contest not found'; return;
  end if;

  if v_status <> 'open' then
    return query select false, 'Contest is not open for entry'; return;
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    return query select false, 'Unknown player'; return;
  end if;

  if v_user.account_status <> 'active' then
    return query select false, 'Account is not active'; return;
  end if;

  if public.is_self_excluded(p_user_id) then
    return query select false, 'Self-exclusion is active'; return;
  end if;

  select * into v_rules from public.contest_eligibility_rules where kind = v_kind;
  if not found then
    return query select false, 'No eligibility rules configured'; return;
  end if;

  if v_rules.requires_kyc and not v_user.kyc_verified then
    return query select false, 'Identity verification required for this contest'; return;
  end if;

  if not v_user.phone_verified then
    return query select false, 'Phone verification required'; return;
  end if;

  if v_user.created_at > now() - make_interval(hours => v_rules.min_account_age_hours) then
    return query select false, format('Account must be at least %s hours old', v_rules.min_account_age_hours); return;
  end if;

  select count(*) into v_ranked_matches
  from public.matches
  where player_1_id = p_user_id or player_2_id = p_user_id;

  if v_ranked_matches < v_rules.min_ranked_matches then
    return query select false, format('Play %s ranked matches to unlock this contest', v_rules.min_ranked_matches); return;
  end if;

  -- The sockpuppet gate: refuse if a linked account already holds a seat.
  if v_rules.enforce_account_links then
    select count(*) into v_linked_entrants
    from public.tournament_entries e
    join public.account_links l
      on (l.user_id_1 = p_user_id and l.user_id_2 = e.user_id)
      or (l.user_id_2 = p_user_id and l.user_id_1 = e.user_id)
    where e.tournament_id = p_tournament_id
      and l.confidence_score >= v_rules.max_link_confidence
      and l.review_action is distinct from 'cleared';

    if v_linked_entrants > 0 then
      return query select false, 'A linked account already holds a seat in this contest'; return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;

-- Enforced at write time as well as at the API layer. An eligibility check
-- that only runs in application code is one forgotten call site away from
-- being no check at all.
create or replace function public.enforce_entry_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_reason text;
begin
  select allowed, reason into v_allowed, v_reason
  from public.check_contest_eligibility(new.user_id, new.tournament_id);

  if not v_allowed then
    raise exception 'Entry refused: %', v_reason using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_entry_eligibility_on_entry
  before insert on public.tournament_entries
  for each row execute function public.enforce_entry_eligibility();

-- ###########################################################################
-- FINDING 4 [HIGH] - Self-exclusion is escapable with a new signup.
--
-- 0004 keys exclusion to user_id. A player who self-excludes and registers a
-- fresh account is unexcluded. In every licensing regime that mandates
-- self-exclusion, it attaches to the person, not the login.
--
-- Fix: exclusion identifiers are hashed identity signals — KYC document hash,
-- phone, payment method, device — checked at signup, deposit, and entry.
-- Hashes only, so the table carries no plaintext PII.
-- ###########################################################################

create table public.exclusion_identifiers (
  id uuid primary key default gen_random_uuid(),
  self_exclusion_id uuid not null references public.self_exclusions (id) on delete cascade,
  identifier_type text not null,
  identifier_hash text not null,
  created_at timestamptz not null default now(),
  constraint exclusion_identifiers_type_check check (
    identifier_type in ('kyc_document', 'phone', 'payment_method', 'device', 'email')
  )
);

create index exclusion_identifiers_hash_idx
  on public.exclusion_identifiers (identifier_type, identifier_hash);

alter table public.exclusion_identifiers enable row level security;
create policy "exclusion_identifiers_deny_all"
  on public.exclusion_identifiers for all to anon, authenticated using (false);

create or replace function public.is_identifier_excluded(
  p_identifier_type text,
  p_identifier_hash text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exclusion_identifiers ei
    join public.self_exclusions se on se.id = ei.self_exclusion_id
    where ei.identifier_type = p_identifier_type
      and ei.identifier_hash = p_identifier_hash
      and (se.is_permanent or se.expires_at > now())
  );
$$;

-- ###########################################################################
-- FINDING 5 [HIGH] - Client-controlled fraud signals are not signals.
--
-- 0003 let authenticated clients INSERT their own device_fingerprints rows.
-- An attacker sends a fresh random hash per account and the linking graph
-- never forms — which silently disables Findings 3's sockpuppet gate, the
-- collusion detector, and the chargeback linker all at once.
--
-- The same reasoning applies to match_replays.player_*_timings: if the client
-- reports how long it took to move, bot detection is defeated by sending
-- plausible jitter.
--
-- Fix: revoke client writes. Fingerprints are derived server-side (request
-- headers plus client entropy, HMAC-ed with a server secret) and timings are
-- measured from message arrival at the game server. Both are written with the
-- service role only.
-- ###########################################################################

drop policy if exists "device_fingerprints_insert_own" on public.device_fingerprints;
revoke insert, update, delete on public.device_fingerprints from authenticated;

revoke insert, update, delete on public.match_replays from authenticated;
revoke insert, update, delete on public.matches from authenticated;
revoke insert, update, delete on public.transactions from authenticated;
revoke insert, update, delete on public.kyc_records from authenticated;
revoke insert, update, delete on public.phone_verifications from authenticated;
revoke insert, update, delete on public.playthrough_progress from authenticated;

-- Withdrawal addresses were client-insertable, which lets an attacker who has
-- stolen a session add a payout destination. Now service-role only, gated on
-- a re-authentication step in the application layer.
drop policy if exists "withdrawal_addresses_insert_own" on public.withdrawal_addresses;
revoke insert, update, delete on public.withdrawal_addresses from authenticated;

-- ###########################################################################
-- FINDING 6 [MEDIUM] - Tournament status could move backwards.
--
-- 0005 locks money terms but leaves `status` free. A completed contest could
-- be reopened for entry after payouts had already been made.
-- ###########################################################################

create or replace function public.enforce_tournament_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_rank_old integer;
  v_rank_new integer;
begin
  v_rank_old := case old.status
    when 'open' then 1 when 'full' then 2 when 'in_progress' then 3
    when 'completed' then 4 when 'cancelled' then 4 end;
  v_rank_new := case new.status
    when 'open' then 1 when 'full' then 2 when 'in_progress' then 3
    when 'completed' then 4 when 'cancelled' then 4 end;

  if v_rank_new < v_rank_old then
    raise exception 'Tournament status cannot move backwards (% -> %)', old.status, new.status;
  end if;

  if old.status in ('completed', 'cancelled') and new.status <> old.status then
    raise exception 'Tournament is already finalised';
  end if;

  return new;
end;
$$;

create trigger enforce_tournament_status_transition_on_update
  before update on public.tournaments
  for each row execute function public.enforce_tournament_status_transition();

-- ###########################################################################
-- FINDING 7 [MEDIUM] - Seat assignment races produce spurious failures.
--
-- Computing seat_number as count(*) + 1 in application code means concurrent
-- entrants collide on the unique index. It fails closed, which is correct, but
-- it fails for a legitimate second player. Assign the seat inside the same
-- locked section that already checks capacity.
-- ###########################################################################

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

  if not found then
    raise exception 'Tournament not found';
  end if;

  if current_status <> 'open' then
    raise exception 'Tournament is not open for entry';
  end if;

  select count(*) into taken
  from public.tournament_entries
  where tournament_id = new.tournament_id;

  if taken >= capacity then
    raise exception 'Tournament is full';
  end if;

  -- Authoritative seat assignment under the row lock.
  new.seat_number := taken + 1;

  if taken + 1 = capacity then
    update public.tournaments set status = 'full' where id = new.tournament_id;
  end if;

  return new;
end;
$$;

-- ###########################################################################
-- FINDING 8 [MEDIUM] - Webhook replay double-credits deposits.
--
-- Stripe retries webhooks on any non-2xx and can deliver the same event more
-- than once even on success. Without a dedup record, a retried
-- payment_intent.succeeded credits the balance twice.
--
-- move_balance's idempotency_key covers the ledger; this table stops the
-- handler re-running its other side effects.
-- ###########################################################################

create table public.processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  constraint processed_webhook_events_unique unique (provider, provider_event_id)
);

create index processed_webhook_events_processed_at_idx
  on public.processed_webhook_events (processed_at desc);

alter table public.processed_webhook_events enable row level security;
create policy "processed_webhook_events_deny_all"
  on public.processed_webhook_events for all to anon, authenticated using (false);

-- ###########################################################################
-- FINDING 9 [LOW] - CHECK constraint used as a rate limiter.
--
-- 0001 constrained phone_verifications.verification_attempts <= 5. The sixth
-- attempt raises a constraint violation, surfacing as a 500 rather than a
-- handled "too many attempts". Widen the constraint and enforce the limit in
-- the application, which can return a proper error and a retry-after.
-- ###########################################################################

alter table public.phone_verifications
  drop constraint if exists phone_verifications_attempts_check;

alter table public.phone_verifications
  add constraint phone_verifications_attempts_check
  check (verification_attempts >= 0 and verification_attempts <= 100);

-- ###########################################################################
-- Residual risk, tracked deliberately rather than silently accepted:
--
--  * Device fingerprinting is evadable by a determined attacker with clean
--    hardware and residential proxies. It raises cost; it does not eliminate
--    the attack. KYC at the money boundary is the real control.
--  * account_links is populated heuristically. max_link_confidence trades
--    false positives against false negatives; the Milestone threshold (0.40)
--    is deliberately aggressive because a wrongly-blocked entry is a support
--    ticket while a captured Milestone is a public credibility loss.
--  * is_admin() still returns constant false. It MUST be implemented before
--    any administrative surface is exposed.
--  * Raw IPs in device_fingerprints have no retention policy yet. Add one
--    before processing EU traffic.
-- ###########################################################################
