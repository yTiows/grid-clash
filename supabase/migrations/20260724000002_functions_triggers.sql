-- =============================================================================
-- Migration: Functions and triggers for Grid Clash
-- =============================================================================

-- ---------------------------------------------------------------------------
-- set_updated_at: Generic trigger for all tables with updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- handle_new_user: Create user profile on auth signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  candidate_username text;
  attempt integer := 0;
begin
  base_username := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));

  if base_username is null or char_length(base_username) < 3 then
    base_username := 'player_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;

  base_username := substr(base_username, 1, 20);
  candidate_username := base_username;

  while exists (select 1 from public.users where lower(username) = lower(candidate_username)) loop
    attempt := attempt + 1;
    candidate_username := substr(base_username, 1, greatest(1, 20 - length(attempt::text) - 1)) || '_' || attempt;
  end loop;

  insert into public.users (id, username, email, account_status)
  values (new.id, candidate_username, new.email, 'phone_pending');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- flag_bot_behavior: Detect impossible move timing patterns
-- Triggered after match_replays insert. Flags if move timings are suspiciously consistent.
-- ---------------------------------------------------------------------------
create or replace function public.flag_bot_behavior()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p1_timing_stddev numeric;
  p2_timing_stddev numeric;
  p1_user_id uuid;
  p2_user_id uuid;
begin
  select player_1_id, player_2_id into p1_user_id, p2_user_id
  from public.matches where id = new.match_id;

  if new.player_1_timings is not null and array_length(new.player_1_timings, 1) > 5 then
    p1_timing_stddev := (
      select stddev_pop(val::numeric)
      from unnest(new.player_1_timings) as t(val)
    );
    if p1_timing_stddev < 50 then
      insert into public.fraud_flags (user_id, flag_type, severity, reason)
      values (p1_user_id, 'bot_move_timing', 'high', 'Suspiciously consistent move timings');
    end if;
  end if;

  if new.player_2_timings is not null and array_length(new.player_2_timings, 1) > 5 then
    p2_timing_stddev := (
      select stddev_pop(val::numeric)
      from unnest(new.player_2_timings) as t(val)
    );
    if p2_timing_stddev < 50 then
      insert into public.fraud_flags (user_id, flag_type, severity, reason)
      values (p2_user_id, 'bot_move_timing', 'high', 'Suspiciously consistent move timings');
    end if;
  end if;

  return new;
end;
$$;

create trigger flag_bot_behavior_on_replay_insert
  after insert on public.match_replays
  for each row execute function public.flag_bot_behavior();

-- ---------------------------------------------------------------------------
-- flag_chargeback_on_transaction: Auto-flag user if chargeback is recorded
-- ---------------------------------------------------------------------------
create or replace function public.flag_chargeback_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'chargeback_claw' then
    insert into public.fraud_flags (user_id, flag_type, severity, reason)
    values (new.user_id, 'chargeback', 'critical', 'Chargeback recorded on deposit');
    
    update public.users
    set account_status = 'banned'
    where id = new.user_id;
  end if;

  return new;
end;
$$;

create trigger flag_chargeback_on_transaction_insert
  after insert on public.transactions
  for each row execute function public.flag_chargeback_on_transaction();

-- ---------------------------------------------------------------------------
-- link_accounts_by_device: Detect multi-accounting via device fingerprint
-- Called when a new device_fingerprints row is inserted.
-- ---------------------------------------------------------------------------
create or replace function public.link_accounts_by_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_users uuid[];
  other_user uuid;
  link_count integer;
begin
  select array_agg(distinct user_id)
  into existing_users
  from public.device_fingerprints
  where fingerprint_hash = new.fingerprint_hash and user_id != new.user_id;

  if existing_users is not null then
    foreach other_user in array existing_users loop
      link_count := (select count(*) from public.account_links
        where (user_id_1 = new.user_id and user_id_2 = other_user)
           or (user_id_1 = other_user and user_id_2 = new.user_id));

      if link_count = 0 then
        insert into public.account_links (user_id_1, user_id_2, link_type, confidence_score)
        values (
          least(new.user_id, other_user),
          greatest(new.user_id, other_user),
          'device',
          0.85
        );
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger link_accounts_by_device_on_fingerprint_insert
  after insert on public.device_fingerprints
  for each row execute function public.link_accounts_by_device();

-- ---------------------------------------------------------------------------
-- flag_suspicious_match: Detect collusion patterns (same accounts always playing each other)
-- Triggered after match insert.
-- ---------------------------------------------------------------------------
create or replace function public.flag_suspicious_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  match_count integer;
  win_ratio numeric;
  suspicious boolean := false;
begin
  match_count := (
    select count(*)
    from public.matches
    where (player_1_id = new.player_1_id and player_2_id = new.player_2_id)
       or (player_1_id = new.player_2_id and player_2_id = new.player_1_id)
  );

  if match_count > 10 then
    win_ratio := (
      select (count(*) filter (where winner_id = new.player_1_id))::numeric /
             nullif(count(*), 0)
      from public.matches
      where (player_1_id = new.player_1_id and player_2_id = new.player_2_id)
         or (player_1_id = new.player_2_id and player_2_id = new.player_1_id)
    );

    if win_ratio > 0.85 or win_ratio < 0.15 then
      suspicious := true;
    end if;
  end if;

  if suspicious then
    insert into public.fraud_flags (user_id, flag_type, severity, reason)
    values (new.player_1_id, 'collusion_pattern', 'high', 'Unnatural win ratio vs same opponent');
    insert into public.fraud_flags (user_id, flag_type, severity, reason)
    values (new.player_2_id, 'collusion_pattern', 'high', 'Unnatural win ratio vs same opponent');
  end if;

  return new;
end;
$$;

create trigger flag_suspicious_match_on_match_insert
  after insert on public.matches
  for each row execute function public.flag_suspicious_match();

-- ---------------------------------------------------------------------------
-- update_match_stats: Update user stats after match completion
-- ---------------------------------------------------------------------------
create or replace function public.update_match_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set matches_played = matches_played + 1,
      matches_won = matches_won + 1,
      lifetime_winnings_cents = lifetime_winnings_cents + new.winner_payout_cents
  where id = new.winner_id;

  update public.users
  set matches_played = matches_played + 1,
      lifetime_winnings_cents = lifetime_winnings_cents + new.loser_payout_cents
  where id = new.loser_id;

  insert into public.elo_ratings_history (user_id, match_id, elo_before, elo_after, change)
  values (
    new.winner_id,
    new.id,
    (new.elo_change_winner + new.elo_change_winner),
    (new.elo_change_winner + new.elo_change_winner + new.elo_change_winner),
    new.elo_change_winner
  );

  insert into public.elo_ratings_history (user_id, match_id, elo_before, elo_after, change)
  values (
    new.loser_id,
    new.id,
    (new.elo_change_loser + new.elo_change_loser),
    (new.elo_change_loser + new.elo_change_loser + new.elo_change_loser),
    new.elo_change_loser
  );

  return new;
end;
$$;

create trigger update_match_stats_on_match_insert
  after insert on public.matches
  for each row execute function public.update_match_stats();

-- ---------------------------------------------------------------------------
-- RLS helper: is_admin (for future admin operations)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;
