/**
 * Title tiers (player_titles, supabase/migrations/20260724000005_tournaments.sql)
 * are deterministic achievements. Per that migration's own comment, how a
 * tier renders is deliberately never explained in UI copy — only the
 * treatment itself is shown, and meaning spreads by a player seeing it worn.
 * --gold is reserved for money surfaces only (brand/BRAND.md "Colour"), so no
 * tier mark below uses it, including the tier literally named "gold."
 *
 * Extracted out of leaderboard/page.tsx (the original owner of this map) so
 * a second surface rendering the same titles — the profile page — reads
 * from one place instead of risking the exact class of drift this
 * codebase's own history is full of (two copies of one number/mapping
 * silently disagreeing after an edit to only one of them).
 */
export const TITLE_TIER_MARK: Record<string, string> = {
  dollar: "border-white/25 text-muted-foreground",
  bronze: "border-accent text-accent",
  // Silver as a neutral metal rather than a hue — the design system deliberately
  // has only two decorative colors (primary, accent) plus the reserved ones
  // (gold for money, rival for the board), so this tier earns its distinction
  // from brightness, not from a fifth color.
  silver: "border-white/60 text-foreground",
  gold: "border-primary text-primary font-black",
  obsidian: "border-border bg-background text-foreground",
  // Light gradient fill needs dark text for contrast, not text-foreground.
  milestone: "border-border bg-gradient-to-r from-primary to-accent text-background font-black",
}
