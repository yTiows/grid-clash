-- =============================================================================
-- Migration: Wagering eligibility primitive and dependency smoke test
--
-- FOUND BY: executing reserve_stake() against a live database. It raised
-- "function public.assert_can_wager(uuid, integer) does not exist".
--
-- ROOT CAUSE: plpgsql resolves function references at execution time, not at
-- definition time. Migrations 0007 and 0010 both call assert_can_wager, both
-- applied without error, and both were broken. `enter_tournament` — the entire
-- tournament entry path — would have failed on its first real call.
--
-- This is the second seam bug of the same shape as the ledger vocabulary gap:
-- two migrations written apart, each correct alone, disagreeing about a name.
-- A clean migration run proves nothing about whether the functions work. The
-- smoke test at the bottom exists so this class of bug fails at deploy time
-- instead of on a player's first entry.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- assert_can_wager
--
-- The single gate every paid entry passes through: ranked stakes, tournament
-- entries, ladder runs. Raising rather than returning a boolean means a caller
-- cannot accidentally ignore the result — the transaction aborts.
--
-- Ordered cheapest-first, and self-exclusion is checked before anything
-- discretionary so an excluded player is stopped by the shortest path.
-- ---------------------------------------------------------------------------
create or replace function public.assert_can_wager(
  p_user_id uuid,
  p_stake_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_jurisdiction record;
  v_limits record;
  v_today_lost integer;
  v_today_deposited integer;
begin
  if p_stake_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception 'Account not found';
  end if;

  if v_user.account_status <> 'active' then
    raise exception 'Account is not active (%)', v_user.account_status;
  end if;

  -- Checked early and unconditionally. An excluded account must never reach a
  -- code path that could seat it.
  if public.is_self_excluded(p_user_id) then
    raise exception 'Account is self-excluded';
  end if;

  if not v_user.phone_verified then
    raise exception 'Phone verification required before paid entry';
  end if;

  -- Most specific jurisdiction rule wins, falling back to the country row.
  select * into v_jurisdiction
  from public.jurisdiction_rules
  where country_code = coalesce(v_user.kyc_country, 'US')
  order by region_code nulls last
  limit 1;

  if v_jurisdiction.id is not null and not v_jurisdiction.paid_entry_allowed then
    raise exception 'Paid entry is not available in this jurisdiction';
  end if;

  select * into v_limits from public.player_limits where user_id = p_user_id;

  if v_limits.user_id is not null then
    select coalesce(net_loss_cents, 0), coalesce(deposited_cents, 0)
    into v_today_lost, v_today_deposited
    from public.deposit_velocity
    where user_id = p_user_id and window_date = current_date;

    if v_limits.daily_loss_limit_cents is not null
       and coalesce(v_today_lost, 0) + p_stake_cents > v_limits.daily_loss_limit_cents then
      raise exception 'Daily loss limit reached';
    end if;

    if v_limits.weekly_loss_limit_cents is not null then
      select coalesce(sum(net_loss_cents), 0) into v_today_lost
      from public.deposit_velocity
      where user_id = p_user_id and window_date > current_date - 7;

      if coalesce(v_today_lost, 0) + p_stake_cents > v_limits.weekly_loss_limit_cents then
        raise exception 'Weekly loss limit reached';
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.assert_can_wager(uuid, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- assert_function_dependencies
--
-- Executes every function the money paths depend on, with harmless arguments,
-- purely to force plpgsql to resolve its references.
--
-- A migration applying cleanly says nothing about whether its functions can
-- run. This is the check that would have caught assert_can_wager, and it is
-- cheap enough to run on every deploy.
--
-- Failures that indicate a genuine missing dependency (undefined_function)
-- are collected and raised together. Business-rule failures are expected and
-- ignored: the point is resolution, not outcome.
-- ---------------------------------------------------------------------------
create or replace function public.assert_function_dependencies()
returns text
language plpgsql
as $$
declare
  v_user uuid;
  v_gaps text[] := '{}';
begin
  select id into v_user from public.users limit 1;
  if v_user is null then
    return 'skipped: no users to probe with';
  end if;

  begin
    perform public.assert_can_wager(v_user, 100);
  exception
    when undefined_function then v_gaps := v_gaps || 'assert_can_wager';
    when others then null;
  end;

  begin
    perform public.is_self_excluded(v_user);
  exception
    when undefined_function then v_gaps := v_gaps || 'is_self_excluded';
    when others then null;
  end;

  begin
    perform public.accounts_are_linked(v_user, v_user);
  exception
    when undefined_function then v_gaps := v_gaps || 'accounts_are_linked';
    when others then null;
  end;

  begin
    perform public.realised_profit_cents();
  exception
    when undefined_function then v_gaps := v_gaps || 'realised_profit_cents';
    when others then null;
  end;

  begin
    perform public.is_admin();
  exception
    when undefined_function then v_gaps := v_gaps || 'is_admin';
    when others then null;
  end;

  begin
    perform public.reconcile_orphan_reservations(interval '999 years');
  exception
    when undefined_function then v_gaps := v_gaps || 'reconcile_orphan_reservations';
    when others then null;
  end;

  begin
    perform public.assert_ledger_vocabulary();
  exception
    when undefined_function then v_gaps := v_gaps || 'assert_ledger_vocabulary';
    when others then null;
  end;

  -- Probes that must not commit anything: rolled back via a raised exception
  -- inside a nested block.
  begin
    perform public.reserve_stake(v_user, 1);
    raise exception 'rollback_probe';
  exception
    when undefined_function then v_gaps := v_gaps || 'reserve_stake';
    when others then null;
  end;

  if array_length(v_gaps, 1) > 0 then
    raise exception 'Unresolved function dependencies: %', array_to_string(v_gaps, ', ');
  end if;

  return 'ok: all money-path functions resolve';
end;
$$;

revoke execute on function public.assert_function_dependencies() from anon, authenticated;
