-- =============================================================================
-- Migration: add avatar_url to public_players
--
-- A profile picture is meant to be seen by other players — the avatars
-- storage bucket's own read policy is already public
-- (20260801000006_social_tab.sql's avatars_read_all) — but public_players
-- (20260724000006_security_hardening.sql, Finding 1's fix) is a deliberately
-- narrow column allowlist that predates avatar_url existing at all. Without
-- this, a profile page has no RLS-permitted way to read anyone else's
-- avatar_url at all: users_select_own only permits reading your OWN row.
-- Extends the same allowlist rather than adding a second, narrower view.
-- =============================================================================

-- New column appended at the end, not inserted before equipped_title_tier —
-- CREATE OR REPLACE VIEW treats repositioning an existing output column as
-- a rename, which Postgres refuses.
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
    t.tier as equipped_title_tier,
    u.avatar_url
  from public.users u
  left join public.player_titles t
    on t.user_id = u.id and t.is_equipped
  where u.account_status = 'active';

comment on view public.public_players is
  'The only user data reachable by anon (plus the only way an authenticated user reads ANOTHER player''s row at all — users_select_own is self-only). Never add email, phone, balance, or KYC columns here.';
