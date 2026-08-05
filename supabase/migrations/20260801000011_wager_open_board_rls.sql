-- FOUND (2026-08-01, while building the open-wager board page): the only
-- existing SELECT policy on challenges is challenges_select_involved
-- (challenger_id = auth.uid() OR target_id = auth.uid()). An open wager sits
-- with target_id NULL until accepted, so under that policy alone literally
-- no one but the poster could ever see it -- there is no way for anyone to
-- discover and accept an open wager at all. This adds the missing read path
-- for the public board specifically: any authenticated user may see a
-- pending, still-open (target_id IS NULL) wager. Everything else about a
-- challenges row (accepted wagers, friend challenges once a target is set,
-- terminal states) stays governed by the existing participant-only policy.

drop policy if exists challenges_select_open_board on public.challenges;
create policy challenges_select_open_board
on public.challenges
for select
to authenticated
using (status = 'pending' and target_id is null);

create or replace function public.assert_open_wager_board_visible()
returns text
language plpgsql
as $$
declare
  v_visible_count integer;
begin
  -- RLS enforcement itself is not testable from this connection (the
  -- SQL-editor role is the table owner and bypasses RLS -- the same
  -- limitation this project's other RLS-adjacent self-tests already work
  -- around), so this checks the policy actually exists with the right
  -- predicate rather than exercising a real cross-role SELECT.
  select count(*) into v_visible_count
  from pg_policies
  where tablename = 'challenges'
    and policyname = 'challenges_select_open_board'
    and qual = $qual$((status = 'pending'::text) AND (target_id IS NULL))$qual$;

  if v_visible_count = 0 then
    raise exception 'Expected challenges_select_open_board policy with the pending+target_id-null predicate to exist';
  end if;

  return 'ok: challenges_select_open_board policy exists with the expected predicate';
end;
$$;

revoke execute on function public.assert_open_wager_board_visible() from anon, authenticated;

select public.assert_open_wager_board_visible() as assert_open_wager_board_visible;
