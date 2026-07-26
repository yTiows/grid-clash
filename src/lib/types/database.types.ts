// Generated from live schema introspection against a from-scratch replay of
// all 19 migrations. Regenerate with:
//   npx supabase gen types typescript --linked > src/lib/types/database.types.ts
// once a real Supabase project exists.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type AccountStatus = "active" | "suspended" | "banned" | "kyc_pending" | "phone_pending"
export type TransactionType = "deposit" | "withdrawal" | "match_payout" | "bonus" | "refund" | "chargeback_claw"
export type TransactionStatus = "pending" | "completed" | "failed" | "on_hold" | "cancelled"
export type KycStatus = "pending" | "approved" | "rejected" | "expired"
export type LinkType = "device" | "ip" | "payment_method" | "phone" | "email_domain" | "address_zip" | "creation_time"
export type FraudSeverity = "low" | "medium" | "high" | "critical"
export type AddressType = "stripe_connected_account" | "bank_account" | "wallet"
export type FeeTier = "standard" | "established" | "elite"
export type PayoutStatus = "pending" | "in_transit" | "paid" | "failed" | "reversed"

export interface Database {
  public: {
    Tables: {
      account_links: {
        Row: {
          id: string
          user_id_1: string
          user_id_2: string
          link_type: string
          confidence_score: number
          flagged_at: string
          reviewed_at: string | null
          review_action: string | null
        }
        Insert: {
          id?: string
          user_id_1: string
          user_id_2: string
          link_type: string
          confidence_score: number
          flagged_at?: string
          reviewed_at?: string | null
          review_action?: string | null
        }
        Update: {
          id?: string
          user_id_1?: string
          user_id_2?: string
          link_type?: string
          confidence_score?: number
          flagged_at?: string
          reviewed_at?: string | null
          review_action?: string | null
        }
        Relationships: []
      }
      automation_refunds: {
        Row: {
          id: string
          review_id: string
          victim_user_id: string
          match_id: string | null
          refund_cents: number
          paid_at: string | null
        }
        Insert: {
          id?: string
          review_id: string
          victim_user_id: string
          match_id?: string | null
          refund_cents: number
          paid_at?: string | null
        }
        Update: {
          id?: string
          review_id?: string
          victim_user_id?: string
          match_id?: string | null
          refund_cents?: number
          paid_at?: string | null
        }
        Relationships: []
      }
      automation_reviews: {
        Row: {
          id: string
          user_id: string
          suspicion_score: number
          action: string
          latency_std_dev_ms: number | null
          optimal_move_rate: number | null
          longest_session_hours: number | null
          active_hours_spread: number | null
          matches_sampled: number
          opened_at: string
          resolved_at: string | null
          resolution: string | null
          reviewer_note: string | null
        }
        Insert: {
          id?: string
          user_id: string
          suspicion_score: number
          action: string
          latency_std_dev_ms?: number | null
          optimal_move_rate?: number | null
          longest_session_hours?: number | null
          active_hours_spread?: number | null
          matches_sampled: number
          opened_at?: string
          resolved_at?: string | null
          resolution?: string | null
          reviewer_note?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          suspicion_score?: number
          action?: string
          latency_std_dev_ms?: number | null
          optimal_move_rate?: number | null
          longest_session_hours?: number | null
          active_hours_spread?: number | null
          matches_sampled?: number
          opened_at?: string
          resolved_at?: string | null
          resolution?: string | null
          reviewer_note?: string | null
        }
        Relationships: []
      }
      balance_entries: {
        Row: {
          id: string
          user_id: string
          amount_cents: number
          balance_after_cents: number
          reason: string
          match_id: string | null
          tournament_id: string | null
          transaction_id: string | null
          idempotency_key: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount_cents: number
          balance_after_cents: number
          reason: string
          match_id?: string | null
          tournament_id?: string | null
          transaction_id?: string | null
          idempotency_key: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          amount_cents?: number
          balance_after_cents?: number
          reason?: string
          match_id?: string | null
          tournament_id?: string | null
          transaction_id?: string | null
          idempotency_key?: string
          created_at?: string
        }
        Relationships: []
      }
      challenge_preferences: {
        Row: {
          user_id: string
          accepts_challenges: boolean
          min_stake_cents: number | null
          max_stake_cents: number | null
          updated_at: string
        }
        Insert: {
          user_id: string
          accepts_challenges?: boolean
          min_stake_cents?: number | null
          max_stake_cents?: number | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          accepts_challenges?: boolean
          min_stake_cents?: number | null
          max_stake_cents?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      challenges: {
        Row: {
          id: string
          challenger_id: string
          target_id: string
          stake_cents: number
          ruleset_id: string
          status: string
          created_at: string
          responded_at: string | null
          expires_at: string
          match_id: string | null
        }
        Insert: {
          id?: string
          challenger_id: string
          target_id: string
          stake_cents: number
          ruleset_id: string
          status?: string
          created_at?: string
          responded_at?: string | null
          expires_at: string
          match_id?: string | null
        }
        Update: {
          id?: string
          challenger_id?: string
          target_id?: string
          stake_cents?: number
          ruleset_id?: string
          status?: string
          created_at?: string
          responded_at?: string | null
          expires_at?: string
          match_id?: string | null
        }
        Relationships: []
      }
      comeback_claims: {
        Row: {
          id: string
          user_id: string
          consecutive_losses: number
          played_losses: number
          refund_cents: number
          median_stake_cents: number
          claimed_at: string
        }
        Insert: {
          id?: string
          user_id: string
          consecutive_losses: number
          played_losses: number
          refund_cents: number
          median_stake_cents: number
          claimed_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          consecutive_losses?: number
          played_losses?: number
          refund_cents?: number
          median_stake_cents?: number
          claimed_at?: string
        }
        Relationships: []
      }
      contest_eligibility_rules: {
        Row: {
          kind: string
          requires_kyc: boolean
          min_account_age_hours: number
          min_ranked_matches: number
          enforce_account_links: boolean
          max_link_confidence: number
        }
        Insert: {
          kind: string
          requires_kyc?: boolean
          min_account_age_hours?: number
          min_ranked_matches?: number
          enforce_account_links?: boolean
          max_link_confidence?: number
        }
        Update: {
          kind?: string
          requires_kyc?: boolean
          min_account_age_hours?: number
          min_ranked_matches?: number
          enforce_account_links?: boolean
          max_link_confidence?: number
        }
        Relationships: []
      }
      deposit_velocity: {
        Row: {
          user_id: string
          window_date: string
          deposited_cents: number
          net_loss_cents: number
        }
        Insert: {
          user_id: string
          window_date: string
          deposited_cents?: number
          net_loss_cents?: number
        }
        Update: {
          user_id?: string
          window_date?: string
          deposited_cents?: number
          net_loss_cents?: number
        }
        Relationships: []
      }
      device_fingerprints: {
        Row: {
          id: string
          user_id: string
          fingerprint_hash: string
          user_agent: string
          ip_address: string
          timezone: string | null
          language: string | null
          first_seen_at: string
          last_seen_at: string
          is_primary: boolean
        }
        Insert: {
          id?: string
          user_id: string
          fingerprint_hash: string
          user_agent: string
          ip_address: string
          timezone?: string | null
          language?: string | null
          first_seen_at?: string
          last_seen_at?: string
          is_primary?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          fingerprint_hash?: string
          user_agent?: string
          ip_address?: string
          timezone?: string | null
          language?: string | null
          first_seen_at?: string
          last_seen_at?: string
          is_primary?: boolean
        }
        Relationships: []
      }
      elo_ratings_history: {
        Row: {
          id: string
          user_id: string
          match_id: string
          elo_before: number
          elo_after: number
          change: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          match_id: string
          elo_before: number
          elo_after: number
          change: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          match_id?: string
          elo_before?: number
          elo_after?: number
          change?: number
          created_at?: string
        }
        Relationships: []
      }
      exclusion_identifiers: {
        Row: {
          id: string
          self_exclusion_id: string
          identifier_type: string
          identifier_hash: string
          created_at: string
        }
        Insert: {
          id?: string
          self_exclusion_id: string
          identifier_type: string
          identifier_hash: string
          created_at?: string
        }
        Update: {
          id?: string
          self_exclusion_id?: string
          identifier_type?: string
          identifier_hash?: string
          created_at?: string
        }
        Relationships: []
      }
      fraud_flags: {
        Row: {
          id: string
          user_id: string
          flag_type: string
          severity: string
          reason: string | null
          triggered_at: string
          reviewed_at: string | null
          review_action: string | null
        }
        Insert: {
          id?: string
          user_id: string
          flag_type: string
          severity: string
          reason?: string | null
          triggered_at?: string
          reviewed_at?: string | null
          review_action?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          flag_type?: string
          severity?: string
          reason?: string | null
          triggered_at?: string
          reviewed_at?: string | null
          review_action?: string | null
        }
        Relationships: []
      }
      ip_blocks: {
        Row: {
          id: string
          ip_address: string
          reason: string | null
          added_at: string
          expires_at: string | null
        }
        Insert: {
          id?: string
          ip_address: string
          reason?: string | null
          added_at?: string
          expires_at?: string | null
        }
        Update: {
          id?: string
          ip_address?: string
          reason?: string | null
          added_at?: string
          expires_at?: string | null
        }
        Relationships: []
      }
      jurisdiction_rules: {
        Row: {
          id: string
          country_code: string
          region_code: string | null
          paid_entry_allowed: boolean
          free_play_allowed: boolean
          minimum_age: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          country_code: string
          region_code?: string | null
          paid_entry_allowed: boolean
          free_play_allowed?: boolean
          minimum_age?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          country_code?: string
          region_code?: string | null
          paid_entry_allowed?: boolean
          free_play_allowed?: boolean
          minimum_age?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      kyc_records: {
        Row: {
          id: string
          user_id: string
          provider: string
          provider_verification_id: string
          status: string
          full_name: string | null
          date_of_birth: string | null
          country_code: string | null
          id_type: string | null
          id_number_hash: string | null
          sanction_check_passed: boolean | null
          sanction_check_at: string | null
          verified_at: string | null
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          provider_verification_id: string
          status: string
          full_name?: string | null
          date_of_birth?: string | null
          country_code?: string | null
          id_type?: string | null
          id_number_hash?: string | null
          sanction_check_passed?: boolean | null
          sanction_check_at?: string | null
          verified_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          provider_verification_id?: string
          status?: string
          full_name?: string | null
          date_of_birth?: string | null
          country_code?: string | null
          id_type?: string | null
          id_number_hash?: string | null
          sanction_check_passed?: boolean | null
          sanction_check_at?: string | null
          verified_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      ladder_rung_results: {
        Row: {
          id: string
          run_id: string
          rung: number
          match_id: string | null
          won: boolean
          bank_value_cents: number
          played_at: string
        }
        Insert: {
          id?: string
          run_id: string
          rung: number
          match_id?: string | null
          won: boolean
          bank_value_cents: number
          played_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          rung?: number
          match_id?: string | null
          won?: boolean
          bank_value_cents?: number
          played_at?: string
        }
        Relationships: []
      }
      ladder_runs: {
        Row: {
          id: string
          user_id: string
          ruleset_id: string
          entry_fee_cents: number
          current_rung: number
          max_rung: number
          status: string
          banked_cents: number | null
          started_at: string
          ended_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          ruleset_id: string
          entry_fee_cents: number
          current_rung?: number
          max_rung: number
          status?: string
          banked_cents?: number | null
          started_at?: string
          ended_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          ruleset_id?: string
          entry_fee_cents?: number
          current_rung?: number
          max_rung?: number
          status?: string
          banked_cents?: number | null
          started_at?: string
          ended_at?: string | null
        }
        Relationships: []
      }
      match_replays: {
        Row: {
          id: string
          match_id: string
          replay_data: Json
          move_sequence: string[] | null
          player_1_timings: number[] | null
          player_2_timings: number[] | null
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          replay_data: Json
          move_sequence?: string[] | null
          player_1_timings?: number[] | null
          player_2_timings?: number[] | null
          created_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          replay_data?: Json
          move_sequence?: string[] | null
          player_1_timings?: number[] | null
          player_2_timings?: number[] | null
          created_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          id: string
          player_1_id: string
          player_2_id: string
          winner_id: string
          loser_id: string
          entry_fee_cents: number
          winner_payout_cents: number
          loser_payout_cents: number
          platform_rake_cents: number
          ranked: boolean
          elo_change_winner: number | null
          elo_change_loser: number | null
          duration_seconds: number | null
          reported: boolean
          dispute_resolution: string | null
          created_at: string
          completed_at: string
        }
        Insert: {
          id?: string
          player_1_id: string
          player_2_id: string
          winner_id: string
          loser_id: string
          entry_fee_cents: number
          winner_payout_cents: number
          loser_payout_cents?: number
          platform_rake_cents: number
          ranked?: boolean
          elo_change_winner?: number | null
          elo_change_loser?: number | null
          duration_seconds?: number | null
          reported?: boolean
          dispute_resolution?: string | null
          created_at?: string
          completed_at?: string
        }
        Update: {
          id?: string
          player_1_id?: string
          player_2_id?: string
          winner_id?: string
          loser_id?: string
          entry_fee_cents?: number
          winner_payout_cents?: number
          loser_payout_cents?: number
          platform_rake_cents?: number
          ranked?: boolean
          elo_change_winner?: number | null
          elo_change_loser?: number | null
          duration_seconds?: number | null
          reported?: boolean
          dispute_resolution?: string | null
          created_at?: string
          completed_at?: string
        }
        Relationships: []
      }
      payment_method_blocks: {
        Row: {
          id: string
          payment_method_hash: string
          reason: string | null
          added_at: string
          expires_at: string | null
        }
        Insert: {
          id?: string
          payment_method_hash: string
          reason?: string | null
          added_at?: string
          expires_at?: string | null
        }
        Update: {
          id?: string
          payment_method_hash?: string
          reason?: string | null
          added_at?: string
          expires_at?: string | null
        }
        Relationships: []
      }
      payouts: {
        Row: {
          id: string
          user_id: string
          amount_cents: number
          stripe_transfer_id: string | null
          status: string
          failure_reason: string | null
          requested_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount_cents: number
          stripe_transfer_id?: string | null
          status?: string
          failure_reason?: string | null
          requested_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount_cents?: number
          stripe_transfer_id?: string | null
          status?: string
          failure_reason?: string | null
          requested_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      personal_bests: {
        Row: {
          user_id: string
          longest_win_streak: number
          current_win_streak: number
          current_loss_streak: number
          highest_elo: number
          biggest_upset_elo: number
          fastest_win_seconds: number | null
          best_finish_place: number | null
          total_matches: number
          net_profit_cents: number
          updated_at: string
        }
        Insert: {
          user_id: string
          longest_win_streak?: number
          current_win_streak?: number
          current_loss_streak?: number
          highest_elo?: number
          biggest_upset_elo?: number
          fastest_win_seconds?: number | null
          best_finish_place?: number | null
          total_matches?: number
          net_profit_cents?: number
          updated_at?: string
        }
        Update: {
          user_id?: string
          longest_win_streak?: number
          current_win_streak?: number
          current_loss_streak?: number
          highest_elo?: number
          biggest_upset_elo?: number
          fastest_win_seconds?: number | null
          best_finish_place?: number | null
          total_matches?: number
          net_profit_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      phone_verifications: {
        Row: {
          id: string
          user_id: string
          phone_number: string
          carrier_name: string | null
          is_voip: boolean
          phone_age_days: number | null
          verification_attempts: number
          last_attempt_at: string | null
          verified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          phone_number: string
          carrier_name?: string | null
          is_voip?: boolean
          phone_age_days?: number | null
          verification_attempts?: number
          last_attempt_at?: string | null
          verified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          phone_number?: string
          carrier_name?: string | null
          is_voip?: boolean
          phone_age_days?: number | null
          verification_attempts?: number
          last_attempt_at?: string | null
          verified_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      platform_ledger: {
        Row: {
          id: string
          entry_type: string
          amount_cents: number
          match_id: string | null
          tournament_id: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          entry_type: string
          amount_cents: number
          match_id?: string | null
          tournament_id?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          entry_type?: string
          amount_cents?: number
          match_id?: string | null
          tournament_id?: string | null
          note?: string | null
          created_at?: string
        }
        Relationships: []
      }
      play_sessions: {
        Row: {
          id: string
          user_id: string
          started_at: string
          ended_at: string | null
          matches_played: number
          net_result_cents: number
          last_reality_check_at: string | null
          reality_checks_shown: number
        }
        Insert: {
          id?: string
          user_id: string
          started_at?: string
          ended_at?: string | null
          matches_played?: number
          net_result_cents?: number
          last_reality_check_at?: string | null
          reality_checks_shown?: number
        }
        Update: {
          id?: string
          user_id?: string
          started_at?: string
          ended_at?: string | null
          matches_played?: number
          net_result_cents?: number
          last_reality_check_at?: string | null
          reality_checks_shown?: number
        }
        Relationships: []
      }
      player_limits: {
        Row: {
          user_id: string
          daily_deposit_limit_cents: number | null
          weekly_deposit_limit_cents: number | null
          monthly_deposit_limit_cents: number | null
          daily_loss_limit_cents: number | null
          weekly_loss_limit_cents: number | null
          session_duration_limit_minutes: number | null
          pending_daily_deposit_limit_cents: number | null
          pending_weekly_deposit_limit_cents: number | null
          pending_monthly_deposit_limit_cents: number | null
          pending_daily_loss_limit_cents: number | null
          pending_weekly_loss_limit_cents: number | null
          pending_effective_at: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          daily_deposit_limit_cents?: number | null
          weekly_deposit_limit_cents?: number | null
          monthly_deposit_limit_cents?: number | null
          daily_loss_limit_cents?: number | null
          weekly_loss_limit_cents?: number | null
          session_duration_limit_minutes?: number | null
          pending_daily_deposit_limit_cents?: number | null
          pending_weekly_deposit_limit_cents?: number | null
          pending_monthly_deposit_limit_cents?: number | null
          pending_daily_loss_limit_cents?: number | null
          pending_weekly_loss_limit_cents?: number | null
          pending_effective_at?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          daily_deposit_limit_cents?: number | null
          weekly_deposit_limit_cents?: number | null
          monthly_deposit_limit_cents?: number | null
          daily_loss_limit_cents?: number | null
          weekly_loss_limit_cents?: number | null
          session_duration_limit_minutes?: number | null
          pending_daily_deposit_limit_cents?: number | null
          pending_weekly_deposit_limit_cents?: number | null
          pending_monthly_deposit_limit_cents?: number | null
          pending_daily_loss_limit_cents?: number | null
          pending_weekly_loss_limit_cents?: number | null
          pending_effective_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      player_rewards: {
        Row: {
          id: string
          user_id: string
          reward_id: string
          kind: string
          earned_from_tournament_id: string | null
          earned_at: string
          expires_at: string | null
          consumed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          reward_id: string
          kind: string
          earned_from_tournament_id?: string | null
          earned_at?: string
          expires_at?: string | null
          consumed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          reward_id?: string
          kind?: string
          earned_from_tournament_id?: string | null
          earned_at?: string
          expires_at?: string | null
          consumed_at?: string | null
        }
        Relationships: []
      }
      player_standing: {
        Row: {
          user_id: string
          skill_index: number
          si_rating: number
          si_opposition: number
          si_consistency: number
          si_volume: number
          si_fair_play: number
          skill_index_percentile: number | null
          confidence: number
          is_provisional: boolean
          trust_score: number
          trust_band: string
          fee_tier: string
          distinct_opponents: number
          average_opponent_elo: number | null
          performance_std_dev: number | null
          upheld_fair_play_findings: number
          computed_at: string
        }
        Insert: {
          user_id: string
          skill_index?: number
          si_rating?: number
          si_opposition?: number
          si_consistency?: number
          si_volume?: number
          si_fair_play?: number
          skill_index_percentile?: number | null
          confidence?: number
          is_provisional?: boolean
          trust_score?: number
          trust_band?: string
          fee_tier?: string
          distinct_opponents?: number
          average_opponent_elo?: number | null
          performance_std_dev?: number | null
          upheld_fair_play_findings?: number
          computed_at?: string
        }
        Update: {
          user_id?: string
          skill_index?: number
          si_rating?: number
          si_opposition?: number
          si_consistency?: number
          si_volume?: number
          si_fair_play?: number
          skill_index_percentile?: number | null
          confidence?: number
          is_provisional?: boolean
          trust_score?: number
          trust_band?: string
          fee_tier?: string
          distinct_opponents?: number
          average_opponent_elo?: number | null
          performance_std_dev?: number | null
          upheld_fair_play_findings?: number
          computed_at?: string
        }
        Relationships: []
      }
      player_titles: {
        Row: {
          id: string
          user_id: string
          tier: string
          tournament_id: string | null
          earned_at: string
          is_equipped: boolean
        }
        Insert: {
          id?: string
          user_id: string
          tier: string
          tournament_id?: string | null
          earned_at?: string
          is_equipped?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          tier?: string
          tournament_id?: string | null
          earned_at?: string
          is_equipped?: boolean
        }
        Relationships: []
      }
      playthrough_progress: {
        Row: {
          id: string
          transaction_id: string
          user_id: string
          required_playthrough_cents: number
          completed_playthrough_cents: number
          qualifying_matches: number
          expires_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          transaction_id: string
          user_id: string
          required_playthrough_cents: number
          completed_playthrough_cents?: number
          qualifying_matches?: number
          expires_at: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          transaction_id?: string
          user_id?: string
          required_playthrough_cents?: number
          completed_playthrough_cents?: number
          qualifying_matches?: number
          expires_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      processed_webhook_events: {
        Row: {
          id: string
          provider: string
          provider_event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          id?: string
          provider: string
          provider_event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          id?: string
          provider?: string
          provider_event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      rivalries: {
        Row: {
          user_id: string
          opponent_id: string
          wins: number
          losses: number
          draws: number
          net_cents: number
          last_played_at: string
        }
        Insert: {
          user_id: string
          opponent_id: string
          wins?: number
          losses?: number
          draws?: number
          net_cents?: number
          last_played_at?: string
        }
        Update: {
          user_id?: string
          opponent_id?: string
          wins?: number
          losses?: number
          draws?: number
          net_cents?: number
          last_played_at?: string
        }
        Relationships: []
      }
      rulesets: {
        Row: {
          id: string
          name: string
          board_size: number
          connect_target: number
          move_timeout_ms: number
          inv_normal: number
          inv_shield: number
          inv_bomb: number
          inv_swap: number
          blurb: string
          is_active: boolean
        }
        Insert: {
          id: string
          name: string
          board_size: number
          connect_target: number
          move_timeout_ms: number
          inv_normal: number
          inv_shield: number
          inv_bomb: number
          inv_swap: number
          blurb: string
          is_active?: boolean
        }
        Update: {
          id?: string
          name?: string
          board_size?: number
          connect_target?: number
          move_timeout_ms?: number
          inv_normal?: number
          inv_shield?: number
          inv_bomb?: number
          inv_swap?: number
          blurb?: string
          is_active?: boolean
        }
        Relationships: []
      }
      satellite_seats: {
        Row: {
          id: string
          won_in_tournament_id: string
          target_tournament_id: string
          user_id: string
          seat_value_cents: number
          status: string
          redeemed_at: string | null
          converted_to_cash_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          won_in_tournament_id: string
          target_tournament_id: string
          user_id: string
          seat_value_cents: number
          status?: string
          redeemed_at?: string | null
          converted_to_cash_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          won_in_tournament_id?: string
          target_tournament_id?: string
          user_id?: string
          seat_value_cents?: number
          status?: string
          redeemed_at?: string | null
          converted_to_cash_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      season_archive: {
        Row: {
          id: string
          season_id: string
          user_id: string
          final_rank: number
          final_skill_index: number
          matches_played: number
          archived_at: string
        }
        Insert: {
          id?: string
          season_id: string
          user_id: string
          final_rank: number
          final_skill_index: number
          matches_played: number
          archived_at?: string
        }
        Update: {
          id?: string
          season_id?: string
          user_id?: string
          final_rank?: number
          final_skill_index?: number
          matches_played?: number
          archived_at?: string
        }
        Relationships: []
      }
      self_exclusions: {
        Row: {
          id: string
          user_id: string
          started_at: string
          expires_at: string | null
          is_permanent: boolean
          reason: string | null
        }
        Insert: {
          id?: string
          user_id: string
          started_at?: string
          expires_at?: string | null
          is_permanent?: boolean
          reason?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          started_at?: string
          expires_at?: string | null
          is_permanent?: boolean
          reason?: string | null
        }
        Relationships: []
      }
      stake_reservations: {
        Row: {
          id: string
          user_id: string
          amount_cents: number
          status: string
          match_id: string | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount_cents: number
          status?: string
          match_id?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount_cents?: number
          status?: string
          match_id?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
      tournament_bounties: {
        Row: {
          id: string
          tournament_id: string
          head_user_id: string
          amount_cents: number
          claimed_by_user_id: string | null
          claimed_at: string | null
          claimed_in_match_id: string | null
        }
        Insert: {
          id?: string
          tournament_id: string
          head_user_id: string
          amount_cents: number
          claimed_by_user_id?: string | null
          claimed_at?: string | null
          claimed_in_match_id?: string | null
        }
        Update: {
          id?: string
          tournament_id?: string
          head_user_id?: string
          amount_cents?: number
          claimed_by_user_id?: string | null
          claimed_at?: string | null
          claimed_in_match_id?: string | null
        }
        Relationships: []
      }
      tournament_entries: {
        Row: {
          id: string
          tournament_id: string
          user_id: string
          seat_number: number
          entry_fee_paid_cents: number
          entered_at: string
          eliminated_at: string | null
          final_place: number | null
        }
        Insert: {
          id?: string
          tournament_id: string
          user_id: string
          seat_number: number
          entry_fee_paid_cents: number
          entered_at?: string
          eliminated_at?: string | null
          final_place?: number | null
        }
        Update: {
          id?: string
          tournament_id?: string
          user_id?: string
          seat_number?: number
          entry_fee_paid_cents?: number
          entered_at?: string
          eliminated_at?: string | null
          final_place?: number | null
        }
        Relationships: []
      }
      tournament_matches: {
        Row: {
          id: string
          tournament_id: string
          round_id: string
          match_id: string | null
          player_1_id: string | null
          player_2_id: string | null
          winner_id: string | null
          is_bye: boolean
          board_position: number
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          round_id: string
          match_id?: string | null
          player_1_id?: string | null
          player_2_id?: string | null
          winner_id?: string | null
          is_bye?: boolean
          board_position: number
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          tournament_id?: string
          round_id?: string
          match_id?: string | null
          player_1_id?: string | null
          player_2_id?: string | null
          winner_id?: string | null
          is_bye?: boolean
          board_position?: number
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      tournament_payouts: {
        Row: {
          id: string
          tournament_id: string
          user_id: string
          place: number
          amount_cents: number
          paid_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          user_id: string
          place: number
          amount_cents: number
          paid_at?: string
        }
        Update: {
          id?: string
          tournament_id?: string
          user_id?: string
          place?: number
          amount_cents?: number
          paid_at?: string
        }
        Relationships: []
      }
      tournament_rounds: {
        Row: {
          id: string
          tournament_id: string
          round_number: number
          status: string
          started_at: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          tournament_id: string
          round_number: number
          status?: string
          started_at?: string | null
          completed_at?: string | null
        }
        Update: {
          id?: string
          tournament_id?: string
          round_number?: number
          status?: string
          started_at?: string | null
          completed_at?: string | null
        }
        Relationships: []
      }
      tournaments: {
        Row: {
          id: string
          kind: string
          name: string
          entry_fee_cents: number
          field_size: number
          rake_bps: number
          gross_cents: number
          rake_cents: number
          prize_pool_cents: number
          status: string
          registration_opens_at: string
          starts_at: string | null
          completed_at: string | null
          milestone_index: number | null
          created_at: string
          format_id: string
          ruleset_id: string
          rounds: number
          bounty_share_bps: number
          bounty_pool_cents: number
          bounty_per_head_cents: number
          place_pool_cents: number | null
          guaranteed_pool_cents: number | null
          overlay_cents: number
          satellite_target_tournament_id: string | null
          satellite_seat_value_cents: number | null
        }
        Insert: {
          id?: string
          kind: string
          name: string
          entry_fee_cents: number
          field_size: number
          rake_bps: number
          gross_cents: number
          rake_cents: number
          prize_pool_cents: number
          status?: string
          registration_opens_at?: string
          starts_at?: string | null
          completed_at?: string | null
          milestone_index?: number | null
          created_at?: string
          format_id?: string
          ruleset_id?: string
          rounds?: number
          bounty_share_bps?: number
          bounty_pool_cents?: number
          bounty_per_head_cents?: number
          place_pool_cents?: number | null
          guaranteed_pool_cents?: number | null
          overlay_cents?: number
          satellite_target_tournament_id?: string | null
          satellite_seat_value_cents?: number | null
        }
        Update: {
          id?: string
          kind?: string
          name?: string
          entry_fee_cents?: number
          field_size?: number
          rake_bps?: number
          gross_cents?: number
          rake_cents?: number
          prize_pool_cents?: number
          status?: string
          registration_opens_at?: string
          starts_at?: string | null
          completed_at?: string | null
          milestone_index?: number | null
          created_at?: string
          format_id?: string
          ruleset_id?: string
          rounds?: number
          bounty_share_bps?: number
          bounty_pool_cents?: number
          bounty_per_head_cents?: number
          place_pool_cents?: number | null
          guaranteed_pool_cents?: number | null
          overlay_cents?: number
          satellite_target_tournament_id?: string | null
          satellite_seat_value_cents?: number | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          type: string
          amount_cents: number
          status: string
          payment_provider: string | null
          provider_transaction_id: string | null
          hold_until_at: string | null
          is_bonus: boolean
          bonus_playthrough_required_cents: number | null
          bonus_playthrough_completed_cents: number
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          amount_cents: number
          status?: string
          payment_provider?: string | null
          provider_transaction_id?: string | null
          hold_until_at?: string | null
          is_bonus?: boolean
          bonus_playthrough_required_cents?: number | null
          bonus_playthrough_completed_cents?: number
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          amount_cents?: number
          status?: string
          payment_provider?: string | null
          provider_transaction_id?: string | null
          hold_until_at?: string | null
          is_bonus?: boolean
          bonus_playthrough_required_cents?: number | null
          bonus_playthrough_completed_cents?: number
          created_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          username: string
          email: string
          balance_cents: number
          elo_rating: number
          lifetime_deposits_cents: number
          lifetime_winnings_cents: number
          matches_played: number
          matches_won: number
          phone_verified: boolean
          phone_number: string | null
          kyc_verified: boolean
          kyc_verified_at: string | null
          kyc_provider_user_id: string | null
          kyc_country: string | null
          account_status: string
          created_at: string
          updated_at: string
          date_of_birth_self_attested: string | null
          terms_accepted_at: string | null
          stripe_customer_id: string | null
          stripe_connect_account_id: string | null
          stripe_connect_payouts_enabled: boolean
          stripe_connect_onboarded_at: string | null
        }
        Insert: {
          id: string
          username: string
          email: string
          balance_cents?: number
          elo_rating?: number
          lifetime_deposits_cents?: number
          lifetime_winnings_cents?: number
          matches_played?: number
          matches_won?: number
          phone_verified?: boolean
          phone_number?: string | null
          kyc_verified?: boolean
          kyc_verified_at?: string | null
          kyc_provider_user_id?: string | null
          kyc_country?: string | null
          account_status?: string
          created_at?: string
          updated_at?: string
          date_of_birth_self_attested?: string | null
          terms_accepted_at?: string | null
          stripe_customer_id?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_payouts_enabled?: boolean
          stripe_connect_onboarded_at?: string | null
        }
        Update: {
          id?: string
          username?: string
          email?: string
          balance_cents?: number
          elo_rating?: number
          lifetime_deposits_cents?: number
          lifetime_winnings_cents?: number
          matches_played?: number
          matches_won?: number
          phone_verified?: boolean
          phone_number?: string | null
          kyc_verified?: boolean
          kyc_verified_at?: string | null
          kyc_provider_user_id?: string | null
          kyc_country?: string | null
          account_status?: string
          created_at?: string
          updated_at?: string
          date_of_birth_self_attested?: string | null
          terms_accepted_at?: string | null
          stripe_customer_id?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_payouts_enabled?: boolean
          stripe_connect_onboarded_at?: string | null
        }
        Relationships: []
      }
      withdrawal_addresses: {
        Row: {
          id: string
          user_id: string
          address: string
          address_type: string
          is_primary: boolean
          kyc_verified: boolean
          added_at: string
        }
        Insert: {
          id?: string
          user_id: string
          address: string
          address_type: string
          is_primary?: boolean
          kyc_verified?: boolean
          added_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          address?: string
          address_type?: string
          is_primary?: boolean
          kyc_verified?: boolean
          added_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard: {
        Row: {
          id: string | null
          username: string | null
          elo_rating: number | null
          matches_played: number | null
          matches_won: number | null
          skill_index: number | null
          trust_band: string | null
          is_provisional: boolean | null
          equipped_title_tier: string | null
          rank: number | null
        }
        Relationships: []
      }
      milestone_progress: {
        Row: {
          realised_profit_cents: number | null
          threshold_cents: number | null
          milestones_earned: number | null
          progress_cents: number | null
          milestones_created: number | null
        }
        Relationships: []
      }
      public_players: {
        Row: {
          id: string | null
          username: string | null
          elo_rating: number | null
          matches_played: number | null
          matches_won: number | null
          created_at: string | null
          equipped_title_tier: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accounts_are_linked: {
        Args: {
          a: string
          b: string
        }
        Returns: boolean
      }
      assert_can_wager: {
        Args: {
          p_user_id: string
          p_stake_cents: number
        }
        Returns: undefined
      }
      assert_function_dependencies: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      assert_ledger_vocabulary: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      assert_settlement_works: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      assert_tournament_completion_works: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      assert_tournament_entry_works: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      audit_balance_drift: {
        Args: Record<PropertyKey, never>
        Returns: unknown[]
      }
      check_contest_eligibility: {
        Args: {
          p_user_id: string
          p_tournament_id: string
        }
        Returns: unknown[]
      }
      complete_tournament: {
        Args: {
          p_tournament_id: string
          p_placings: Json
        }
        Returns: undefined
      }
      create_tournament_round: {
        Args: {
          p_tournament_id: string
          p_round_number: number
          p_pairings: Json
        }
        Returns: string
      }
      enter_tournament: {
        Args: {
          p_user_id: string
          p_tournament_id: string
        }
        Returns: string
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_identifier_excluded: {
        Args: {
          p_identifier_type: string
          p_identifier_hash: string
        }
        Returns: boolean
      }
      is_self_excluded: {
        Args: {
          target_user_id: string
        }
        Returns: boolean
      }
      move_balance: {
        Args: {
          p_user_id: string
          p_amount_cents: number
          p_reason: string
          p_idempotency_key: string
          p_match_id?: string
          p_tournament_id?: string
          p_transaction_id?: string
        }
        Returns: number
      }
      realised_profit_cents: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      reconcile_orphan_reservations: {
        Args: {
          p_older_than?: unknown
        }
        Returns: number
      }
      record_tournament_match_result: {
        Args: {
          p_tournament_match_id: string
          p_winner_id: string
          p_match_id?: string
        }
        Returns: undefined
      }
      record_withdrawal_outcome: {
        Args: {
          p_payout_id: string
          p_stripe_transfer_id: string | null
          p_status: string
          p_failure_reason?: string | null
        }
        Returns: undefined
      }
      refund_stake: {
        Args: {
          p_reservation_id: string
        }
        Returns: boolean
      }
      request_withdrawal: {
        Args: {
          p_user_id: string
          p_amount_cents: number
        }
        Returns: string
      }
      reserve_stake: {
        Args: {
          p_user_id: string
          p_amount_cents: number
        }
        Returns: string
      }
      settle_ranked_match: {
        Args: {
          p_match_id: string
          p_reservation_1: string
          p_reservation_2: string
          p_winner_id: string | null
          p_loser_id: string | null
          p_is_draw: boolean
          p_stake_cents: number
          p_fee_cents: number
          p_winner_payout_cents: number
          p_elo_delta_winner: number
          p_elo_delta_loser: number
          p_reason: string
          p_duration_seconds: number
          p_replay: Json
          p_move_sequence: string[]
          p_timings_1: number[]
          p_timings_2: number[]
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"]
