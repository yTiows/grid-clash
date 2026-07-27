-- =============================================================================
-- Migration: match dispute queue
--
-- Per CLAUDE_CODE_BRIEF.md §4.5: real money settles automatically and
-- instantly (settle_ranked_match, complete_tournament); today a player has no
-- in-product way to contest a result, only support-outside-the-app. This adds
-- the minimal real path: a player who was in the match can file one dispute
-- per match, an admin reviews it and records a decision. No automated
-- arbitration, no automatic reversal — a human decides, and if money needs to
-- move it moves through move_balance/move_loyalty_points like everything
-- else, with the dispute row as the audit trail for why.
-- =============================================================================

create table public.match_disputes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  filed_by_user_id uuid not null references public.users (id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  resolution_note text,
  resolved_by_user_id uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  adjustment_cents integer,
  created_at timestamptz not null default now(),
  constraint match_disputes_one_per_match_per_filer unique (match_id, filed_by_user_id),
  constraint match_disputes_reason_length check (char_length(reason) between 1 and 2000),
  constraint match_disputes_status_check check (
    status in ('open', 'reviewing', 'upheld', 'denied')
  ),
  constraint match_disputes_resolved_shape check (
    (status in ('open', 'reviewing')) = (resolved_at is null)
  )
);

create index match_disputes_match_idx on public.match_disputes (match_id);
create index match_disputes_status_idx on public.match_disputes (status) where status in ('open', 'reviewing');
create index match_disputes_filed_by_idx on public.match_disputes (filed_by_user_id);

comment on table public.match_disputes is
  'A player-filed contest of a settled match result. Resolution is a human admin decision recorded here, never automated; any resulting money movement goes through move_balance separately and is referenced by this row for audit.';

alter table public.match_disputes enable row level security;

create policy "match_disputes_select_own" on public.match_disputes
  for select to authenticated
  using (
    auth.uid() = filed_by_user_id
    or exists (
      select 1 from public.matches m
      where m.id = match_id and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

grant select on public.match_disputes to authenticated;

-- ---------------------------------------------------------------------------
-- file_match_dispute
-- Only a participant in the match may file, only within a review window
-- (7 days — long enough to notice, short enough that the ledger trail is
-- still fresh), and only once per match per player. Runs under the caller's
-- own session, not service-role: the eligibility checks are the only guard
-- and they must not be bypassable by calling with someone else's id.
-- ---------------------------------------------------------------------------
create or replace function public.file_match_dispute(
  p_match_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_dispute_id uuid;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'Match not found';
  end if;

  if v_match.player_1_id <> v_caller and v_match.player_2_id <> v_caller then
    raise exception 'Only a participant in this match may file a dispute';
  end if;

  if v_match.completed_at < now() - interval '7 days' then
    raise exception 'Disputes must be filed within 7 days of the match';
  end if;

  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  insert into public.match_disputes (match_id, filed_by_user_id, reason)
  values (p_match_id, v_caller, trim(p_reason))
  on conflict (match_id, filed_by_user_id) do nothing
  returning id into v_dispute_id;

  if v_dispute_id is null then
    raise exception 'You have already filed a dispute for this match';
  end if;

  return v_dispute_id;
end;
$$;

revoke execute on function public.file_match_dispute(uuid, text) from anon;
grant execute on function public.file_match_dispute(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_match_dispute
-- Admin-only (checked via is_admin(), the same gate every other admin action
-- in this codebase uses). An optional adjustment_cents applies a real,
-- audited balance correction through move_balance — never a raw UPDATE of
-- balance_cents — keyed on the dispute id so a resolved-then-retried call
-- cannot double-adjust.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_match_dispute(
  p_dispute_id uuid,
  p_status text,
  p_resolution_note text,
  p_adjustment_user_id uuid default null,
  p_adjustment_cents integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute record;
  v_caller uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_status not in ('reviewing', 'upheld', 'denied') then
    raise exception 'Invalid resolution status: %', p_status;
  end if;

  select * into v_dispute from public.match_disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'Dispute not found';
  end if;

  if v_dispute.status in ('upheld', 'denied') then
    -- Already finalised. Idempotent no-op rather than an error, so a
    -- double-click in the admin UI cannot re-adjust a settled dispute.
    return;
  end if;

  if p_adjustment_cents is not null and p_adjustment_cents <> 0 then
    if p_adjustment_user_id is null then
      raise exception 'An adjustment amount requires an adjustment_user_id';
    end if;
    perform public.move_balance(
      p_adjustment_user_id, p_adjustment_cents, 'adjustment',
      'dispute_adjustment:' || p_dispute_id::text
    );
  end if;

  update public.match_disputes
  set status = p_status,
      resolution_note = p_resolution_note,
      resolved_by_user_id = case when p_status in ('upheld', 'denied') then v_caller else null end,
      resolved_at = case when p_status in ('upheld', 'denied') then now() else null end,
      adjustment_cents = p_adjustment_cents
  where id = p_dispute_id;
end;
$$;

revoke execute on function public.resolve_match_dispute(uuid, text, text, uuid, integer) from anon;
grant execute on function public.resolve_match_dispute(uuid, text, text, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin read surface. Disputes are participant-scoped under RLS above; the
-- admin queue needs to see every open one regardless of who filed it.
-- Enforced by is_admin() inside the function body rather than a broader RLS
-- policy, so the base table stays participant-only for every other caller.
-- ---------------------------------------------------------------------------
create or replace function public.list_open_disputes()
returns setof public.match_disputes
language sql
stable
security definer
set search_path = public
as $$
  select d.* from public.match_disputes d
  where public.is_admin()
  order by d.created_at asc;
$$;

revoke execute on function public.list_open_disputes() from anon;
grant execute on function public.list_open_disputes() to authenticated;
