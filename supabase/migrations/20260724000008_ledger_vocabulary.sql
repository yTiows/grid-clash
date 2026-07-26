-- =============================================================================
-- Migration: Ledger reason codes for the tournament format layer
--
-- FOUND BY: executing migrations 0001-0007 against Postgres 16 and calling
-- move_balance() with each money path the format layer introduces.
--
-- BUG: migration 0006 fixed the ledger's allowed `reason` values against the
-- money paths that existed at the time. Migration 0007 then added bounties,
-- satellite seats, ladder banking and guarantee overlay — four new ways money
-- moves — without extending that list.
--
-- IMPACT: every one of those paths would have raised a check-constraint
-- violation the first time it ran in production. Because move_balance is the
-- only way balance changes, and it debits before it writes the ledger row, the
-- failure mode is a transaction abort mid-settlement: a bounty claim or ladder
-- bank that looks like a server error to the player and leaves the contest
-- unsettled. Not a money-loss bug — the transaction rolls back — but it would
-- have broken bounty and ladder formats completely on first use.
--
-- This is a seam bug: neither migration is wrong in isolation. It is only
-- visible when the schema is executed and exercised, which is why parse
-- checking did not surface it.
-- =============================================================================

alter table public.balance_entries
  drop constraint if exists balance_entries_reason_check;

alter table public.balance_entries
  add constraint balance_entries_reason_check check (
    reason = any (array[
      -- Funding
      'deposit',
      'withdrawal',
      'withdrawal_reversed',
      'chargeback',

      -- Ranked
      'ranked_entry',
      'ranked_payout',
      'ranked_refund',

      -- Tournament, all formats
      'tournament_entry',
      'tournament_payout',
      'tournament_refund',

      -- Bounty format: a claim pays the eliminator from the carved bounty
      -- pool, separately from place money.
      'bounty_claim',
      'bounty_refund',

      -- Satellite: a seat that cannot be used converts to cash at face value
      -- to the same account. Never transferable, so never to another account.
      'satellite_conversion',

      -- Ladder: entry, banking a run, and busting out are distinct events and
      -- are recorded distinctly so a run can be audited rung by rung.
      'ladder_entry',
      'ladder_bank',
      'ladder_bust',

      -- Guarantee overlay is paid into the prize pool by the platform. It
      -- lands in platform_ledger as a negative, not here, but a refund of an
      -- overlaid contest can return money to a player.
      'guarantee_refund',

      -- Manual, always attributable to an operator via the audit trail.
      'adjustment'
    ])
  );

-- The same gap exists on the platform side: guarantee overlay and bounty pool
-- movements were added to platform_ledger's enum in 0007, but satellite
-- conversion and ladder settlement were not.
alter table public.platform_ledger
  drop constraint if exists platform_ledger_entry_type_check;

alter table public.platform_ledger
  add constraint platform_ledger_entry_type_check check (
    entry_type = any (array[
      'ranked_rake',
      'tournament_rake',
      'ladder_rake',
      'milestone_subsidy',
      'guarantee_overlay',
      'bounty_pool',
      'satellite_conversion',
      'refund',
      'adjustment'
    ])
  );

-- ---------------------------------------------------------------------------
-- Regression guard.
--
-- The bug above was possible because the ledger's vocabulary and the code that
-- uses it live in different files and drifted apart. This function asserts
-- that every reason code the application is expected to emit is actually
-- accepted, so the next person to add a money path finds out at migration time
-- rather than in production.
--
-- Called by the test suite; cheap enough to run in CI on every deploy.
-- ---------------------------------------------------------------------------
create or replace function public.assert_ledger_vocabulary()
returns text
language plpgsql
as $$
declare
  required_reasons text[] := array[
    'deposit','withdrawal','withdrawal_reversed','chargeback',
    'ranked_entry','ranked_payout','ranked_refund',
    'tournament_entry','tournament_payout','tournament_refund',
    'bounty_claim','bounty_refund','satellite_conversion',
    'ladder_entry','ladder_bank','ladder_bust',
    'guarantee_refund','adjustment'
  ];
  r text;
  gaps text[] := '{}';
  probe_user uuid;
  probe_key text;
begin
  select id into probe_user from public.users limit 1;
  if probe_user is null then
    return 'skipped: no users to probe with';
  end if;

  -- Probe the live constraint by attempting a write and rolling it back.
  -- Parsing pg_get_constraintdef with a regex was the first attempt and it
  -- silently passed against a broken constraint, which is worse than no guard.
  foreach r in array required_reasons loop
    probe_key := 'vocab_probe_' || gen_random_uuid()::text;
    begin
      insert into public.balance_entries
        (user_id, amount_cents, balance_after_cents, reason, idempotency_key)
      values (probe_user, 1, 1, r, probe_key);
      delete from public.balance_entries where idempotency_key = probe_key;
    exception when check_violation then
      gaps := gaps || r;
    end;
  end loop;

  if array_length(gaps, 1) > 0 then
    raise exception 'Ledger vocabulary gap: % not accepted by balance_entries_reason_check',
      array_to_string(gaps, ', ');
  end if;

  return 'ok: all ' || array_length(required_reasons, 1) || ' reason codes accepted';
end;
$$;

revoke execute on function public.assert_ledger_vocabulary() from anon, authenticated;
