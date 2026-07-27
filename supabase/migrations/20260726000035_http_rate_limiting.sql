-- =============================================================================
-- Migration: durable HTTP-layer rate limiting
--
-- Per CLAUDE_CODE_BRIEF.md §4.3. src/lib/middleware/rate-limit.ts already
-- existed but was an in-memory Map (own comment: "suitable for 5k users;
-- upgrade to Redis for scale") that nothing in src/ ever imported — dead
-- code, and not durable across serverless invocations or multiple instances
-- even if it had been wired in.
--
-- CHOICE: Postgres-backed fixed-window counter, not Redis. This platform
-- targets ~5,000 users on infrastructure that is already just this Supabase
-- project — adding Redis means a new service, a new secret, and a new
-- failure mode for a request volume (signup/login/deposit/withdrawal, NOT
-- in-match moves, which already have their own token bucket in the WS
-- server) this table will never come close to stressing. A single row
-- lock per (bucket, key) check is cheap at this scale and reuses
-- infrastructure that already exists, matching §6's "prefer the smallest
-- real solution."  Revisit only if this platform ever needs a rate limiter
-- shared across many stateless edge regions at real volume — it does not
-- today.
-- =============================================================================

create table public.rate_limit_counters (
  bucket text not null,
  rate_key text not null,
  window_start timestamptz not null default clock_timestamp(),
  count integer not null default 0,
  primary key (bucket, rate_key)
);

comment on table public.rate_limit_counters is
  'Fixed-window HTTP rate limiting. Not for in-match moves (the WS server has its own token bucket) — this is for signup/login/deposit/withdrawal-class endpoints.';

alter table public.rate_limit_counters enable row level security;
create policy "rate_limit_counters_deny_all" on public.rate_limit_counters
  for all to anon, authenticated using (false);

-- ---------------------------------------------------------------------------
-- check_rate_limit
-- Atomic check-and-increment: the row lock (or the insert's own uniqueness)
-- is what makes two concurrent requests for the same key resolve correctly
-- instead of both reading a stale count and both being allowed — the same
-- TOCTOU concern move_balance's single UPDATE...WHERE exists to close.
-- Callable pre-auth (login, signup), so granted to anon as well as
-- authenticated; the table itself stays locked down to security-definer
-- access only.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket text,
  p_rate_key text,
  p_window_ms integer,
  p_max_requests integer
)
returns table (allowed boolean, remaining integer, retry_after_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_now timestamptz := clock_timestamp();
begin
  if p_window_ms <= 0 or p_max_requests <= 0 then
    raise exception 'check_rate_limit: window_ms and max_requests must be positive';
  end if;

  loop
    select * into v_row from public.rate_limit_counters
    where bucket = p_bucket and rate_key = p_rate_key
    for update;

    if not found then
      begin
        insert into public.rate_limit_counters (bucket, rate_key, window_start, count)
        values (p_bucket, p_rate_key, v_now, 1);
        return query select true, greatest(0, p_max_requests - 1), 0;
        return;
      exception when unique_violation then
        -- Lost a race to insert the first row for this key; retry via the
        -- select/update path above.
        continue;
      end;
    end if;

    if v_now - v_row.window_start > make_interval(secs => p_window_ms / 1000.0) then
      update public.rate_limit_counters
      set window_start = v_now, count = 1
      where bucket = p_bucket and rate_key = p_rate_key;
      return query select true, greatest(0, p_max_requests - 1), 0;
      return;
    end if;

    if v_row.count >= p_max_requests then
      return query select
        false,
        0,
        greatest(0, ceil(extract(epoch from (
          v_row.window_start + make_interval(secs => p_window_ms / 1000.0) - v_now
        )) * 1000))::integer;
      return;
    end if;

    update public.rate_limit_counters
    set count = count + 1
    where bucket = p_bucket and rate_key = p_rate_key;

    return query select true, greatest(0, p_max_requests - v_row.count - 1), 0;
    return;
  end loop;
end;
$$;

revoke execute on function public.check_rate_limit(text, text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, text, integer, integer) to anon, authenticated;

-- Maintenance: called opportunistically from the standing-recompute cron
-- (§4.6/§5.4) rather than standing up a second scheduled job just for this —
-- row count at this scale (a handful of buckets x active users) never
-- justifies its own cron entry.
create or replace function public.cleanup_rate_limit_counters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.rate_limit_counters
  where window_start < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.cleanup_rate_limit_counters() from anon, authenticated;
