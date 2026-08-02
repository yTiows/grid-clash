-- =============================================================================
-- Migration: re-seed public.rulesets, add hidden_shields, sync to current
-- src/lib/game/rulesets.ts
--
-- Found live-breaking during Phase 2 work (2026-08-01): public.rulesets —
-- the FK target for tournaments.ruleset_id, challenges.ruleset_id, and
-- ladder_runs.ruleset_id — is completely EMPTY on the live project, despite
-- migration 20260724000007 seeding all 8 original rows. The most likely
-- cause is the test-data wipe CLAUDE_CODE_BRIEF.md §3 already documents
-- (a blanket TRUNCATE that also caught this reference/config table, not
-- just probe user data — the exact class of mistake that section already
-- warns about for auth.users, just not caught here at the time). Net
-- effect: right now, on the live project, creating ANY tournament,
-- challenge, or ladder run fails outright on the ruleset_id foreign key —
-- this is not a Phase 2 feature gap, it's the whole tournament/challenge
-- system being down.
--
-- Also: src/lib/game/rulesets.ts has grown two rulesets (gambit, feint)
-- since migration 7 was written, and a hiddenShields field on the Ruleset
-- interface (engine.ts's bluffing mechanic — Feint's entire premise) with
-- no matching database column, even though this table's own migration
-- comment states its job is to "mirror src/lib/game/rulesets.ts." Both
-- fixed here in the same pass, since re-seeding without also syncing shape
-- would leave the exact drift this migration exists to close.
--
-- Idempotent via ON CONFLICT ... DO UPDATE rather than DO NOTHING, so a
-- future partial/stale row self-heals instead of silently persisting.
-- =============================================================================

alter table public.rulesets
  add column if not exists hidden_shields boolean not null default false;

insert into public.rulesets
  (id, name, board_size, connect_target, move_timeout_ms, inv_normal, inv_shield, inv_bomb, inv_swap, hidden_shields, blurb)
values
  ('classic',    'Classic',    5, 4, 5000,  8, 1, 1, 1, false, '5x5, connect 4. One shield, one bomb, one swap.'),
  ('blitz',      'Blitz',      5, 4, 3000,  8, 1, 1, 1, false, 'Classic on a 3-second clock. Read faster.'),
  ('purist',     'Purist',     5, 4, 5000, 12, 0, 0, 0, false, 'No specials. Nothing hidden but intent.'),
  ('siege',      'Siege',      6, 5, 7000, 12, 2, 2, 1, false, '6x6, connect 5. Deeper board, heavier toolkit.'),
  ('demolition', 'Demolition', 5, 4, 5000,  6, 1, 4, 1, false, 'Four bombs each. Nothing you build is safe.'),
  ('fortress',   'Fortress',   5, 4, 5000,  7, 4, 1, 0, false, 'Four shields each. Commit early, defend it.'),
  ('shuffle',    'Shuffle',    5, 4, 5000,  7, 1, 0, 4, false, 'Four swaps each. The board never sits still.'),
  ('sprawl',     'Sprawl',     7, 5, 8000, 18, 2, 2, 2, false, '7x7, connect 5. Long game.'),
  ('gambit',     'Gambit',     5, 4, 5000,  6, 2, 2, 2, false, '5x5, connect 4. Two of everything -- the tools recur, so does the pressure.'),
  ('feint',      'Feint',      5, 4, 5000,  8, 1, 1, 1, true,  'Classic, but a shield looks like a normal piece until you test it.')
on conflict (id) do update set
  name = excluded.name,
  board_size = excluded.board_size,
  connect_target = excluded.connect_target,
  move_timeout_ms = excluded.move_timeout_ms,
  inv_normal = excluded.inv_normal,
  inv_shield = excluded.inv_shield,
  inv_bomb = excluded.inv_bomb,
  inv_swap = excluded.inv_swap,
  hidden_shields = excluded.hidden_shields,
  blurb = excluded.blurb;

-- ---------------------------------------------------------------------------
-- Self-test: confirms every ruleset_id src/lib/game/rulesets.ts's RULESETS
-- export actually has a matching, FK-satisfying row — the specific failure
-- mode this migration exists to close. Hardcodes the id list (rather than
-- reading it from TypeScript, which SQL can't do) so this breaks loudly the
-- next time a ruleset is added to rulesets.ts without a matching DB row,
-- instead of surfacing as an opaque FK violation the next time someone
-- tries to create a tournament in that ruleset.
-- ---------------------------------------------------------------------------
create or replace function public.assert_rulesets_seeded()
returns text
language plpgsql
as $$
declare
  v_expected text[] := array['classic','blitz','purist','siege','demolition','fortress','shuffle','sprawl','gambit','feint'];
  v_missing text[];
begin
  select array_agg(id) into v_missing
  from unnest(v_expected) as id
  where id not in (select id from public.rulesets);

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    raise exception 'rulesets missing from public.rulesets (would break tournament/challenge/ladder creation): %', v_missing;
  end if;

  return 'ok: every ruleset in src/lib/game/rulesets.ts has a matching public.rulesets row';
end;
$$;

revoke execute on function public.assert_rulesets_seeded() from anon, authenticated;

select public.assert_rulesets_seeded();
