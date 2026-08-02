export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_links: {
        Row: {
          confidence_score: number
          flagged_at: string
          id: string
          link_type: string
          review_action: string | null
          reviewed_at: string | null
          user_id_1: string
          user_id_2: string
        }
        Insert: {
          confidence_score: number
          flagged_at?: string
          id?: string
          link_type: string
          review_action?: string | null
          reviewed_at?: string | null
          user_id_1: string
          user_id_2: string
        }
        Update: {
          confidence_score?: number
          flagged_at?: string
          id?: string
          link_type?: string
          review_action?: string | null
          reviewed_at?: string | null
          user_id_1?: string
          user_id_2?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_links_user_id_1_fkey"
            columns: ["user_id_1"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_links_user_id_1_fkey"
            columns: ["user_id_1"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_links_user_id_1_fkey"
            columns: ["user_id_1"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_links_user_id_2_fkey"
            columns: ["user_id_2"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_links_user_id_2_fkey"
            columns: ["user_id_2"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_links_user_id_2_fkey"
            columns: ["user_id_2"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_refunds: {
        Row: {
          id: string
          match_id: string | null
          paid_at: string | null
          refund_cents: number
          review_id: string
          victim_user_id: string
        }
        Insert: {
          id?: string
          match_id?: string | null
          paid_at?: string | null
          refund_cents: number
          review_id: string
          victim_user_id: string
        }
        Update: {
          id?: string
          match_id?: string | null
          paid_at?: string | null
          refund_cents?: number
          review_id?: string
          victim_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_refunds_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_refunds_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "automation_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_refunds_victim_user_id_fkey"
            columns: ["victim_user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_refunds_victim_user_id_fkey"
            columns: ["victim_user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_refunds_victim_user_id_fkey"
            columns: ["victim_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_reviews: {
        Row: {
          action: string
          active_hours_spread: number | null
          id: string
          latency_std_dev_ms: number | null
          longest_session_hours: number | null
          matches_sampled: number
          opened_at: string
          optimal_move_rate: number | null
          resolution: string | null
          resolved_at: string | null
          reviewer_note: string | null
          suspicion_score: number
          user_id: string
        }
        Insert: {
          action: string
          active_hours_spread?: number | null
          id?: string
          latency_std_dev_ms?: number | null
          longest_session_hours?: number | null
          matches_sampled: number
          opened_at?: string
          optimal_move_rate?: number | null
          resolution?: string | null
          resolved_at?: string | null
          reviewer_note?: string | null
          suspicion_score: number
          user_id: string
        }
        Update: {
          action?: string
          active_hours_spread?: number | null
          id?: string
          latency_std_dev_ms?: number | null
          longest_session_hours?: number | null
          matches_sampled?: number
          opened_at?: string
          optimal_move_rate?: number | null
          resolution?: string | null
          resolved_at?: string | null
          reviewer_note?: string | null
          suspicion_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      balance_entries: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          created_at: string
          id: string
          idempotency_key: string
          match_id: string | null
          reason: string
          tournament_id: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          created_at?: string
          id?: string
          idempotency_key: string
          match_id?: string | null
          reason: string
          tournament_id?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          match_id?: string | null
          reason?: string
          tournament_id?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_entries_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_entries_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_preferences: {
        Row: {
          accepts_challenges: boolean
          max_stake_cents: number | null
          min_stake_cents: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accepts_challenges?: boolean
          max_stake_cents?: number | null
          min_stake_cents?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accepts_challenges?: boolean
          max_stake_cents?: number | null
          min_stake_cents?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          challenger_id: string
          created_at: string
          expires_at: string
          id: string
          match_id: string | null
          responded_at: string | null
          ruleset_id: string
          stake_cents: number
          status: string
          target_id: string
        }
        Insert: {
          challenger_id: string
          created_at?: string
          expires_at: string
          id?: string
          match_id?: string | null
          responded_at?: string | null
          ruleset_id: string
          stake_cents: number
          status?: string
          target_id: string
        }
        Update: {
          challenger_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          match_id?: string | null
          responded_at?: string | null
          ruleset_id?: string
          stake_cents?: number
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_challenger_id_fkey"
            columns: ["challenger_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_challenger_id_fkey"
            columns: ["challenger_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_challenger_id_fkey"
            columns: ["challenger_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_ruleset_id_fkey"
            columns: ["ruleset_id"]
            isOneToOne: false
            referencedRelation: "rulesets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comeback_claims: {
        Row: {
          claimed_at: string
          consecutive_losses: number
          id: string
          median_stake_cents: number
          played_losses: number
          refund_cents: number
          user_id: string
        }
        Insert: {
          claimed_at?: string
          consecutive_losses: number
          id?: string
          median_stake_cents: number
          played_losses: number
          refund_cents: number
          user_id: string
        }
        Update: {
          claimed_at?: string
          consecutive_losses?: number
          id?: string
          median_stake_cents?: number
          played_losses?: number
          refund_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comeback_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comeback_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comeback_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contest_eligibility_rules: {
        Row: {
          enforce_account_links: boolean
          kind: string
          max_link_confidence: number
          min_account_age_hours: number
          min_ranked_matches: number
          requires_kyc: boolean
        }
        Insert: {
          enforce_account_links?: boolean
          kind: string
          max_link_confidence?: number
          min_account_age_hours?: number
          min_ranked_matches?: number
          requires_kyc?: boolean
        }
        Update: {
          enforce_account_links?: boolean
          kind?: string
          max_link_confidence?: number
          min_account_age_hours?: number
          min_ranked_matches?: number
          requires_kyc?: boolean
        }
        Relationships: []
      }
      deposit_velocity: {
        Row: {
          deposited_cents: number
          net_loss_cents: number
          user_id: string
          window_date: string
        }
        Insert: {
          deposited_cents?: number
          net_loss_cents?: number
          user_id: string
          window_date: string
        }
        Update: {
          deposited_cents?: number
          net_loss_cents?: number
          user_id?: string
          window_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_velocity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_velocity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_velocity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      device_fingerprints: {
        Row: {
          fingerprint_hash: string
          first_seen_at: string
          id: string
          ip_address: unknown
          is_primary: boolean
          language: string | null
          last_seen_at: string
          timezone: string | null
          user_agent: string
          user_id: string
        }
        Insert: {
          fingerprint_hash: string
          first_seen_at?: string
          id?: string
          ip_address: unknown
          is_primary?: boolean
          language?: string | null
          last_seen_at?: string
          timezone?: string | null
          user_agent: string
          user_id: string
        }
        Update: {
          fingerprint_hash?: string
          first_seen_at?: string
          id?: string
          ip_address?: unknown
          is_primary?: boolean
          language?: string | null
          last_seen_at?: string
          timezone?: string | null
          user_agent?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_fingerprints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_fingerprints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_fingerprints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      elo_ratings_history: {
        Row: {
          change: number
          created_at: string
          elo_after: number
          elo_before: number
          id: string
          match_id: string
          user_id: string
        }
        Insert: {
          change: number
          created_at?: string
          elo_after: number
          elo_before: number
          id?: string
          match_id: string
          user_id: string
        }
        Update: {
          change?: number
          created_at?: string
          elo_after?: number
          elo_before?: number
          id?: string
          match_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "elo_ratings_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_ratings_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_ratings_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_ratings_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exclusion_identifiers: {
        Row: {
          created_at: string
          id: string
          identifier_hash: string
          identifier_type: string
          self_exclusion_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier_hash: string
          identifier_type: string
          self_exclusion_id: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier_hash?: string
          identifier_type?: string
          self_exclusion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_identifiers_self_exclusion_id_fkey"
            columns: ["self_exclusion_id"]
            isOneToOne: false
            referencedRelation: "self_exclusions"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_flags: {
        Row: {
          flag_type: string
          id: string
          reason: string | null
          review_action: string | null
          reviewed_at: string | null
          severity: string
          triggered_at: string
          user_id: string
        }
        Insert: {
          flag_type: string
          id?: string
          reason?: string | null
          review_action?: string | null
          reviewed_at?: string | null
          severity: string
          triggered_at?: string
          user_id: string
        }
        Update: {
          flag_type?: string
          id?: string
          reason?: string | null
          review_action?: string | null
          reviewed_at?: string | null
          severity?: string
          triggered_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fraud_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fraud_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ip_blocks: {
        Row: {
          added_at: string
          expires_at: string | null
          id: string
          ip_address: unknown
          reason: string | null
        }
        Insert: {
          added_at?: string
          expires_at?: string | null
          id?: string
          ip_address: unknown
          reason?: string | null
        }
        Update: {
          added_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          reason?: string | null
        }
        Relationships: []
      }
      jurisdiction_rules: {
        Row: {
          country_code: string
          free_play_allowed: boolean
          id: string
          minimum_age: number
          notes: string | null
          paid_entry_allowed: boolean
          region_code: string | null
          updated_at: string
        }
        Insert: {
          country_code: string
          free_play_allowed?: boolean
          id?: string
          minimum_age?: number
          notes?: string | null
          paid_entry_allowed: boolean
          region_code?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string
          free_play_allowed?: boolean
          id?: string
          minimum_age?: number
          notes?: string | null
          paid_entry_allowed?: boolean
          region_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      kyc_records: {
        Row: {
          country_code: string | null
          created_at: string
          date_of_birth: string | null
          expires_at: string | null
          full_name: string | null
          id: string
          id_number_hash: string | null
          id_type: string | null
          provider: string
          provider_verification_id: string
          sanction_check_at: string | null
          sanction_check_passed: boolean | null
          status: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          date_of_birth?: string | null
          expires_at?: string | null
          full_name?: string | null
          id?: string
          id_number_hash?: string | null
          id_type?: string | null
          provider: string
          provider_verification_id: string
          sanction_check_at?: string | null
          sanction_check_passed?: boolean | null
          status: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string
          date_of_birth?: string | null
          expires_at?: string | null
          full_name?: string | null
          id?: string
          id_number_hash?: string | null
          id_type?: string | null
          provider?: string
          provider_verification_id?: string
          sanction_check_at?: string | null
          sanction_check_passed?: boolean | null
          status?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kyc_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyc_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyc_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ladder_rung_results: {
        Row: {
          bank_value_cents: number
          id: string
          match_id: string | null
          played_at: string
          run_id: string
          rung: number
          won: boolean
        }
        Insert: {
          bank_value_cents: number
          id?: string
          match_id?: string | null
          played_at?: string
          run_id: string
          rung: number
          won: boolean
        }
        Update: {
          bank_value_cents?: number
          id?: string
          match_id?: string | null
          played_at?: string
          run_id?: string
          rung?: number
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ladder_rung_results_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_rung_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ladder_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ladder_runs: {
        Row: {
          banked_cents: number | null
          current_rung: number
          ended_at: string | null
          entry_fee_cents: number
          id: string
          max_rung: number
          ruleset_id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          banked_cents?: number | null
          current_rung?: number
          ended_at?: string | null
          entry_fee_cents: number
          id?: string
          max_rung: number
          ruleset_id: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          banked_cents?: number | null
          current_rung?: number
          ended_at?: string | null
          entry_fee_cents?: number
          id?: string
          max_rung?: number
          ruleset_id?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ladder_runs_ruleset_id_fkey"
            columns: ["ruleset_id"]
            isOneToOne: false
            referencedRelation: "rulesets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ladder_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_points: {
        Row: {
          balance_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_points_entries: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          created_at: string
          id: string
          idempotency_key: string
          match_id: string | null
          reason: string
          tournament_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          created_at?: string
          id?: string
          idempotency_key: string
          match_id?: string | null
          reason: string
          tournament_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          match_id?: string | null
          reason?: string
          tournament_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_entries_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_entries_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_disputes: {
        Row: {
          adjustment_cents: number | null
          created_at: string
          filed_by_user_id: string
          id: string
          match_id: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          status: string
        }
        Insert: {
          adjustment_cents?: number | null
          created_at?: string
          filed_by_user_id: string
          id?: string
          match_id: string
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          status?: string
        }
        Update: {
          adjustment_cents?: number | null
          created_at?: string
          filed_by_user_id?: string
          id?: string
          match_id?: string
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_disputes_filed_by_user_id_fkey"
            columns: ["filed_by_user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_disputes_filed_by_user_id_fkey"
            columns: ["filed_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_disputes_filed_by_user_id_fkey"
            columns: ["filed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_disputes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_disputes_resolved_by_user_id_fkey"
            columns: ["resolved_by_user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_disputes_resolved_by_user_id_fkey"
            columns: ["resolved_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_disputes_resolved_by_user_id_fkey"
            columns: ["resolved_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_replays: {
        Row: {
          created_at: string
          id: string
          match_id: string
          move_sequence: string[] | null
          player_1_timings: number[] | null
          player_2_timings: number[] | null
          replay_data: Json
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          move_sequence?: string[] | null
          player_1_timings?: number[] | null
          player_2_timings?: number[] | null
          replay_data: Json
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          move_sequence?: string[] | null
          player_1_timings?: number[] | null
          player_2_timings?: number[] | null
          replay_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "match_replays_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          completed_at: string
          created_at: string
          dispute_resolution: string | null
          duration_seconds: number | null
          elo_change_loser: number | null
          elo_change_winner: number | null
          entry_fee_cents: number
          id: string
          loser_id: string
          loser_payout_cents: number
          platform_rake_cents: number
          player_1_id: string
          player_2_id: string
          ranked: boolean
          reported: boolean
          winner_id: string
          winner_payout_cents: number
        }
        Insert: {
          completed_at?: string
          created_at?: string
          dispute_resolution?: string | null
          duration_seconds?: number | null
          elo_change_loser?: number | null
          elo_change_winner?: number | null
          entry_fee_cents: number
          id?: string
          loser_id: string
          loser_payout_cents?: number
          platform_rake_cents: number
          player_1_id: string
          player_2_id: string
          ranked?: boolean
          reported?: boolean
          winner_id: string
          winner_payout_cents: number
        }
        Update: {
          completed_at?: string
          created_at?: string
          dispute_resolution?: string | null
          duration_seconds?: number | null
          elo_change_loser?: number | null
          elo_change_winner?: number | null
          entry_fee_cents?: number
          id?: string
          loser_id?: string
          loser_payout_cents?: number
          platform_rake_cents?: number
          player_1_id?: string
          player_2_id?: string
          ranked?: boolean
          reported?: boolean
          winner_id?: string
          winner_payout_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "matches_loser_id_fkey"
            columns: ["loser_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_loser_id_fkey"
            columns: ["loser_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_loser_id_fkey"
            columns: ["loser_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_method_blocks: {
        Row: {
          added_at: string
          expires_at: string | null
          id: string
          payment_method_hash: string
          reason: string | null
        }
        Insert: {
          added_at?: string
          expires_at?: string | null
          id?: string
          payment_method_hash: string
          reason?: string | null
        }
        Update: {
          added_at?: string
          expires_at?: string | null
          id?: string
          payment_method_hash?: string
          reason?: string | null
        }
        Relationships: []
      }
      payouts: {
        Row: {
          amount_cents: number
          completed_at: string | null
          failure_reason: string | null
          id: string
          requested_at: string
          status: string
          stripe_transfer_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          completed_at?: string | null
          failure_reason?: string | null
          id?: string
          requested_at?: string
          status?: string
          stripe_transfer_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          completed_at?: string | null
          failure_reason?: string | null
          id?: string
          requested_at?: string
          status?: string
          stripe_transfer_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_bests: {
        Row: {
          best_finish_place: number | null
          biggest_upset_elo: number
          current_loss_streak: number
          current_win_streak: number
          fastest_win_seconds: number | null
          highest_elo: number
          longest_win_streak: number
          net_profit_cents: number
          total_matches: number
          updated_at: string
          user_id: string
        }
        Insert: {
          best_finish_place?: number | null
          biggest_upset_elo?: number
          current_loss_streak?: number
          current_win_streak?: number
          fastest_win_seconds?: number | null
          highest_elo?: number
          longest_win_streak?: number
          net_profit_cents?: number
          total_matches?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          best_finish_place?: number | null
          biggest_upset_elo?: number
          current_loss_streak?: number
          current_win_streak?: number
          fastest_win_seconds?: number | null
          highest_elo?: number
          longest_win_streak?: number
          net_profit_cents?: number
          total_matches?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_bests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_bests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_bests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verifications: {
        Row: {
          carrier_name: string | null
          created_at: string
          id: string
          is_voip: boolean
          last_attempt_at: string | null
          phone_age_days: number | null
          phone_number: string
          user_id: string
          verification_attempts: number
          verified_at: string | null
        }
        Insert: {
          carrier_name?: string | null
          created_at?: string
          id?: string
          is_voip?: boolean
          last_attempt_at?: string | null
          phone_age_days?: number | null
          phone_number: string
          user_id: string
          verification_attempts?: number
          verified_at?: string | null
        }
        Update: {
          carrier_name?: string | null
          created_at?: string
          id?: string
          is_voip?: boolean
          last_attempt_at?: string | null
          phone_age_days?: number | null
          phone_number?: string
          user_id?: string
          verification_attempts?: number
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_ledger: {
        Row: {
          amount_cents: number
          created_at: string
          entry_type: string
          id: string
          match_id: string | null
          note: string | null
          tournament_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          entry_type: string
          id?: string
          match_id?: string | null
          note?: string | null
          tournament_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          entry_type?: string
          id?: string
          match_id?: string | null
          note?: string | null
          tournament_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_ledger_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_ledger_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      play_sessions: {
        Row: {
          ended_at: string | null
          id: string
          last_reality_check_at: string | null
          matches_played: number
          net_result_cents: number
          reality_checks_shown: number
          started_at: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          last_reality_check_at?: string | null
          matches_played?: number
          net_result_cents?: number
          reality_checks_shown?: number
          started_at?: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          last_reality_check_at?: string | null
          matches_played?: number
          net_result_cents?: number
          reality_checks_shown?: number
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      player_limits: {
        Row: {
          daily_deposit_limit_cents: number | null
          daily_loss_limit_cents: number | null
          monthly_deposit_limit_cents: number | null
          pending_daily_deposit_limit_cents: number | null
          pending_daily_loss_limit_cents: number | null
          pending_effective_at: string | null
          pending_monthly_deposit_limit_cents: number | null
          pending_weekly_deposit_limit_cents: number | null
          pending_weekly_loss_limit_cents: number | null
          session_duration_limit_minutes: number | null
          updated_at: string
          user_id: string
          weekly_deposit_limit_cents: number | null
          weekly_loss_limit_cents: number | null
        }
        Insert: {
          daily_deposit_limit_cents?: number | null
          daily_loss_limit_cents?: number | null
          monthly_deposit_limit_cents?: number | null
          pending_daily_deposit_limit_cents?: number | null
          pending_daily_loss_limit_cents?: number | null
          pending_effective_at?: string | null
          pending_monthly_deposit_limit_cents?: number | null
          pending_weekly_deposit_limit_cents?: number | null
          pending_weekly_loss_limit_cents?: number | null
          session_duration_limit_minutes?: number | null
          updated_at?: string
          user_id: string
          weekly_deposit_limit_cents?: number | null
          weekly_loss_limit_cents?: number | null
        }
        Update: {
          daily_deposit_limit_cents?: number | null
          daily_loss_limit_cents?: number | null
          monthly_deposit_limit_cents?: number | null
          pending_daily_deposit_limit_cents?: number | null
          pending_daily_loss_limit_cents?: number | null
          pending_effective_at?: string | null
          pending_monthly_deposit_limit_cents?: number | null
          pending_weekly_deposit_limit_cents?: number | null
          pending_weekly_loss_limit_cents?: number | null
          session_duration_limit_minutes?: number | null
          updated_at?: string
          user_id?: string
          weekly_deposit_limit_cents?: number | null
          weekly_loss_limit_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rewards: {
        Row: {
          consumed_at: string | null
          earned_at: string
          earned_from_tournament_id: string | null
          expires_at: string | null
          id: string
          kind: string
          reward_id: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          earned_at?: string
          earned_from_tournament_id?: string | null
          expires_at?: string | null
          id?: string
          kind: string
          reward_id: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          earned_at?: string
          earned_from_tournament_id?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          reward_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_rewards_earned_from_tournament_id_fkey"
            columns: ["earned_from_tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rewards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rewards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rewards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      player_standing: {
        Row: {
          average_opponent_elo: number | null
          computed_at: string
          confidence: number
          distinct_opponents: number
          fee_tier: string
          is_provisional: boolean
          performance_std_dev: number | null
          si_consistency: number
          si_fair_play: number
          si_opposition: number
          si_rating: number
          si_volume: number
          skill_index: number
          skill_index_percentile: number | null
          trust_band: string
          trust_score: number
          upheld_fair_play_findings: number
          user_id: string
        }
        Insert: {
          average_opponent_elo?: number | null
          computed_at?: string
          confidence?: number
          distinct_opponents?: number
          fee_tier?: string
          is_provisional?: boolean
          performance_std_dev?: number | null
          si_consistency?: number
          si_fair_play?: number
          si_opposition?: number
          si_rating?: number
          si_volume?: number
          skill_index?: number
          skill_index_percentile?: number | null
          trust_band?: string
          trust_score?: number
          upheld_fair_play_findings?: number
          user_id: string
        }
        Update: {
          average_opponent_elo?: number | null
          computed_at?: string
          confidence?: number
          distinct_opponents?: number
          fee_tier?: string
          is_provisional?: boolean
          performance_std_dev?: number | null
          si_consistency?: number
          si_fair_play?: number
          si_opposition?: number
          si_rating?: number
          si_volume?: number
          skill_index?: number
          skill_index_percentile?: number | null
          trust_band?: string
          trust_score?: number
          upheld_fair_play_findings?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_standing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_standing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_standing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      player_titles: {
        Row: {
          earned_at: string
          id: string
          is_equipped: boolean
          tier: string
          tournament_id: string | null
          user_id: string
        }
        Insert: {
          earned_at?: string
          id?: string
          is_equipped?: boolean
          tier: string
          tournament_id?: string | null
          user_id: string
        }
        Update: {
          earned_at?: string
          id?: string
          is_equipped?: boolean
          tier?: string
          tournament_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_titles_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_titles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_titles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_titles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      playthrough_progress: {
        Row: {
          completed_at: string | null
          completed_playthrough_cents: number
          expires_at: string
          id: string
          qualifying_matches: number
          required_playthrough_cents: number
          transaction_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_playthrough_cents?: number
          expires_at: string
          id?: string
          qualifying_matches?: number
          required_playthrough_cents: number
          transaction_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_playthrough_cents?: number
          expires_at?: string
          id?: string
          qualifying_matches?: number
          required_playthrough_cents?: number
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playthrough_progress_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playthrough_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playthrough_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playthrough_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_webhook_events: {
        Row: {
          event_type: string
          id: string
          processed_at: string
          provider: string
          provider_event_id: string
        }
        Insert: {
          event_type: string
          id?: string
          processed_at?: string
          provider: string
          provider_event_id: string
        }
        Update: {
          event_type?: string
          id?: string
          processed_at?: string
          provider?: string
          provider_event_id?: string
        }
        Relationships: []
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          count: number
          rate_key: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          rate_key: string
          window_start?: string
        }
        Update: {
          bucket?: string
          count?: number
          rate_key?: string
          window_start?: string
        }
        Relationships: []
      }
      rivalries: {
        Row: {
          draws: number
          last_played_at: string
          losses: number
          net_cents: number
          opponent_id: string
          user_id: string
          wins: number
        }
        Insert: {
          draws?: number
          last_played_at?: string
          losses?: number
          net_cents?: number
          opponent_id: string
          user_id: string
          wins?: number
        }
        Update: {
          draws?: number
          last_played_at?: string
          losses?: number
          net_cents?: number
          opponent_id?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "rivalries_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rivalries_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rivalries_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rivalries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rivalries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rivalries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rulesets: {
        Row: {
          blurb: string
          board_size: number
          connect_target: number
          hidden_shields: boolean
          id: string
          inv_bomb: number
          inv_normal: number
          inv_shield: number
          inv_swap: number
          is_active: boolean
          move_timeout_ms: number
          name: string
        }
        Insert: {
          blurb: string
          board_size: number
          connect_target: number
          hidden_shields?: boolean
          id: string
          inv_bomb: number
          inv_normal: number
          inv_shield: number
          inv_swap: number
          is_active?: boolean
          move_timeout_ms: number
          name: string
        }
        Update: {
          blurb?: string
          board_size?: number
          connect_target?: number
          hidden_shields?: boolean
          id?: string
          inv_bomb?: number
          inv_normal?: number
          inv_shield?: number
          inv_swap?: number
          is_active?: boolean
          move_timeout_ms?: number
          name?: string
        }
        Relationships: []
      }
      satellite_seats: {
        Row: {
          converted_to_cash_at: string | null
          created_at: string
          id: string
          redeemed_at: string | null
          seat_value_cents: number
          status: string
          target_tournament_id: string
          user_id: string
          won_in_tournament_id: string
        }
        Insert: {
          converted_to_cash_at?: string | null
          created_at?: string
          id?: string
          redeemed_at?: string | null
          seat_value_cents: number
          status?: string
          target_tournament_id: string
          user_id: string
          won_in_tournament_id: string
        }
        Update: {
          converted_to_cash_at?: string | null
          created_at?: string
          id?: string
          redeemed_at?: string | null
          seat_value_cents?: number
          status?: string
          target_tournament_id?: string
          user_id?: string
          won_in_tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "satellite_seats_target_tournament_id_fkey"
            columns: ["target_tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satellite_seats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satellite_seats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satellite_seats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satellite_seats_won_in_tournament_id_fkey"
            columns: ["won_in_tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      season_archive: {
        Row: {
          archived_at: string
          final_rank: number
          final_skill_index: number
          id: string
          matches_played: number
          season_id: string
          user_id: string
        }
        Insert: {
          archived_at?: string
          final_rank: number
          final_skill_index: number
          id?: string
          matches_played: number
          season_id: string
          user_id: string
        }
        Update: {
          archived_at?: string
          final_rank?: number
          final_skill_index?: number
          id?: string
          matches_played?: number
          season_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_archive_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_archive_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_archive_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      self_exclusions: {
        Row: {
          expires_at: string | null
          id: string
          is_permanent: boolean
          reason: string | null
          started_at: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          id?: string
          is_permanent?: boolean
          reason?: string | null
          started_at?: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          id?: string
          is_permanent?: boolean
          reason?: string | null
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "self_exclusions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "self_exclusions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "self_exclusions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stake_reservations: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          match_id: string | null
          resolved_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          match_id?: string | null
          resolved_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          match_id?: string | null
          resolved_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stake_reservations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stake_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stake_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stake_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_bounties: {
        Row: {
          amount_cents: number
          claimed_at: string | null
          claimed_by_user_id: string | null
          claimed_in_match_id: string | null
          head_user_id: string
          id: string
          tournament_id: string
        }
        Insert: {
          amount_cents: number
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          claimed_in_match_id?: string | null
          head_user_id: string
          id?: string
          tournament_id: string
        }
        Update: {
          amount_cents?: number
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          claimed_in_match_id?: string | null
          head_user_id?: string
          id?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_bounties_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_claimed_in_match_id_fkey"
            columns: ["claimed_in_match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_head_user_id_fkey"
            columns: ["head_user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_head_user_id_fkey"
            columns: ["head_user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_head_user_id_fkey"
            columns: ["head_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_bounties_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_entries: {
        Row: {
          eliminated_at: string | null
          entered_at: string
          entry_fee_paid_cents: number
          final_place: number | null
          id: string
          seat_number: number
          tournament_id: string
          user_id: string
        }
        Insert: {
          eliminated_at?: string | null
          entered_at?: string
          entry_fee_paid_cents: number
          final_place?: number | null
          id?: string
          seat_number: number
          tournament_id: string
          user_id: string
        }
        Update: {
          eliminated_at?: string | null
          entered_at?: string
          entry_fee_paid_cents?: number
          final_place?: number | null
          id?: string
          seat_number?: number
          tournament_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_entries_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_matches: {
        Row: {
          board_position: number
          created_at: string
          id: string
          is_bye: boolean
          match_id: string | null
          player_1_id: string | null
          player_2_id: string | null
          round_id: string
          status: string
          tournament_id: string
          winner_id: string | null
        }
        Insert: {
          board_position: number
          created_at?: string
          id?: string
          is_bye?: boolean
          match_id?: string | null
          player_1_id?: string | null
          player_2_id?: string | null
          round_id: string
          status?: string
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          board_position?: number
          created_at?: string
          id?: string
          is_bye?: boolean
          match_id?: string | null
          player_1_id?: string | null
          player_2_id?: string | null
          round_id?: string
          status?: string
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_matches_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "tournament_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_payouts: {
        Row: {
          amount_cents: number
          id: string
          paid_at: string
          place: number
          tournament_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          id?: string
          paid_at?: string
          place: number
          tournament_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          id?: string
          paid_at?: string
          place?: number
          tournament_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_payouts_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_rounds: {
        Row: {
          completed_at: string | null
          id: string
          round_number: number
          started_at: string | null
          status: string
          tournament_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          round_number: number
          started_at?: string | null
          status?: string
          tournament_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          round_number?: number
          started_at?: string | null
          status?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_rounds_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          bounty_per_head_cents: number
          bounty_pool_cents: number
          bounty_share_bps: number
          completed_at: string | null
          created_at: string
          entry_fee_cents: number
          field_commit_mode: string
          field_size: number
          format_id: string
          gross_cents: number
          guaranteed_pool_cents: number | null
          id: string
          kind: string
          milestone_index: number | null
          min_player_tier: string
          name: string
          overlay_cents: number
          place_pool_cents: number | null
          prize_pool_cents: number
          rake_bps: number
          rake_cents: number
          registration_opens_at: string
          rounds: number
          ruleset_id: string
          satellite_seat_value_cents: number | null
          satellite_target_tournament_id: string | null
          starts_at: string | null
          status: string
        }
        Insert: {
          bounty_per_head_cents?: number
          bounty_pool_cents?: number
          bounty_share_bps?: number
          completed_at?: string | null
          created_at?: string
          entry_fee_cents: number
          field_commit_mode?: string
          field_size: number
          format_id?: string
          gross_cents: number
          guaranteed_pool_cents?: number | null
          id?: string
          kind: string
          milestone_index?: number | null
          min_player_tier?: string
          name: string
          overlay_cents?: number
          place_pool_cents?: number | null
          prize_pool_cents: number
          rake_bps: number
          rake_cents: number
          registration_opens_at?: string
          rounds?: number
          ruleset_id?: string
          satellite_seat_value_cents?: number | null
          satellite_target_tournament_id?: string | null
          starts_at?: string | null
          status?: string
        }
        Update: {
          bounty_per_head_cents?: number
          bounty_pool_cents?: number
          bounty_share_bps?: number
          completed_at?: string | null
          created_at?: string
          entry_fee_cents?: number
          field_commit_mode?: string
          field_size?: number
          format_id?: string
          gross_cents?: number
          guaranteed_pool_cents?: number | null
          id?: string
          kind?: string
          milestone_index?: number | null
          min_player_tier?: string
          name?: string
          overlay_cents?: number
          place_pool_cents?: number | null
          prize_pool_cents?: number
          rake_bps?: number
          rake_cents?: number
          registration_opens_at?: string
          rounds?: number
          ruleset_id?: string
          satellite_seat_value_cents?: number | null
          satellite_target_tournament_id?: string | null
          starts_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_ruleset_id_fkey"
            columns: ["ruleset_id"]
            isOneToOne: false
            referencedRelation: "rulesets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_satellite_target_tournament_id_fkey"
            columns: ["satellite_target_tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_cents: number
          bonus_playthrough_completed_cents: number
          bonus_playthrough_required_cents: number | null
          completed_at: string | null
          created_at: string
          hold_until_at: string | null
          id: string
          is_bonus: boolean
          payment_provider: string | null
          provider_transaction_id: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          bonus_playthrough_completed_cents?: number
          bonus_playthrough_required_cents?: number | null
          completed_at?: string | null
          created_at?: string
          hold_until_at?: string | null
          id?: string
          is_bonus?: boolean
          payment_provider?: string | null
          provider_transaction_id?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          bonus_playthrough_completed_cents?: number
          bonus_playthrough_required_cents?: number | null
          completed_at?: string | null
          created_at?: string
          hold_until_at?: string | null
          id?: string
          is_bonus?: boolean
          payment_provider?: string | null
          provider_transaction_id?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          account_status: string
          balance_cents: number
          created_at: string
          date_of_birth_self_attested: string | null
          elo_rating: number
          email: string
          id: string
          is_admin: boolean
          kyc_country: string | null
          kyc_provider_user_id: string | null
          kyc_verified: boolean
          kyc_verified_at: string | null
          lifetime_deposits_cents: number
          lifetime_winnings_cents: number
          matches_played: number
          matches_won: number
          phone_number: string | null
          phone_verified: boolean
          stripe_connect_account_id: string | null
          stripe_connect_onboarded_at: string | null
          stripe_connect_payouts_enabled: boolean
          stripe_customer_id: string | null
          terms_accepted_at: string | null
          updated_at: string
          username: string
        }
        Insert: {
          account_status?: string
          balance_cents?: number
          created_at?: string
          date_of_birth_self_attested?: string | null
          elo_rating?: number
          email: string
          id: string
          is_admin?: boolean
          kyc_country?: string | null
          kyc_provider_user_id?: string | null
          kyc_verified?: boolean
          kyc_verified_at?: string | null
          lifetime_deposits_cents?: number
          lifetime_winnings_cents?: number
          matches_played?: number
          matches_won?: number
          phone_number?: string | null
          phone_verified?: boolean
          stripe_connect_account_id?: string | null
          stripe_connect_onboarded_at?: string | null
          stripe_connect_payouts_enabled?: boolean
          stripe_customer_id?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          account_status?: string
          balance_cents?: number
          created_at?: string
          date_of_birth_self_attested?: string | null
          elo_rating?: number
          email?: string
          id?: string
          is_admin?: boolean
          kyc_country?: string | null
          kyc_provider_user_id?: string | null
          kyc_verified?: boolean
          kyc_verified_at?: string | null
          lifetime_deposits_cents?: number
          lifetime_winnings_cents?: number
          matches_played?: number
          matches_won?: number
          phone_number?: string | null
          phone_verified?: boolean
          stripe_connect_account_id?: string | null
          stripe_connect_onboarded_at?: string | null
          stripe_connect_payouts_enabled?: boolean
          stripe_customer_id?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      withdrawal_addresses: {
        Row: {
          added_at: string
          address: string
          address_type: string
          id: string
          is_primary: boolean
          kyc_verified: boolean
          user_id: string
        }
        Insert: {
          added_at?: string
          address: string
          address_type: string
          id?: string
          is_primary?: boolean
          kyc_verified?: boolean
          user_id: string
        }
        Update: {
          added_at?: string
          address?: string
          address_type?: string
          id?: string
          is_primary?: boolean
          kyc_verified?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      leaderboard: {
        Row: {
          elo_rating: number | null
          equipped_title_tier: string | null
          id: string | null
          is_provisional: boolean | null
          matches_played: number | null
          matches_won: number | null
          rank: number | null
          skill_index: number | null
          trust_band: string | null
          username: string | null
        }
        Relationships: []
      }
      milestone_progress: {
        Row: {
          milestones_created: number | null
          milestones_earned: number | null
          progress_cents: number | null
          realised_profit_cents: number | null
          threshold_cents: number | null
        }
        Relationships: []
      }
      public_players: {
        Row: {
          created_at: string | null
          elo_rating: number | null
          equipped_title_tier: string | null
          id: string | null
          matches_played: number | null
          matches_won: number | null
          username: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accounts_are_linked: { Args: { a: string; b: string }; Returns: boolean }
      assert_bounty_claim_works: { Args: never; Returns: string }
      assert_can_wager: {
        Args: { p_stake_cents: number; p_user_id: string }
        Returns: undefined
      }
      assert_commit_tournament_field_works: { Args: never; Returns: string }
      assert_function_dependencies: { Args: never; Returns: string }
      assert_ledger_vocabulary: { Args: never; Returns: string }
      assert_list_open_disputes_filters_by_status: {
        Args: never
        Returns: string
      }
      assert_loyalty_points_mint_works: { Args: never; Returns: string }
      assert_loyalty_redemption_works: { Args: never; Returns: string }
      assert_rank_tiered_tournament_gating_works: {
        Args: never
        Returns: string
      }
      assert_reference_tables_restored: { Args: never; Returns: string }
      assert_rulesets_seeded: { Args: never; Returns: string }
      assert_satellite_completion_works: { Args: never; Returns: string }
      assert_settlement_works: { Args: never; Returns: string }
      assert_tournament_completion_works: { Args: never; Returns: string }
      assert_tournament_entry_works: { Args: never; Returns: string }
      audit_balance_drift: {
        Args: never
        Returns: {
          cached_cents: number
          drift_cents: number
          ledger_cents: number
          user_id: string
        }[]
      }
      check_contest_eligibility: {
        Args: { p_tournament_id: string; p_user_id: string }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      check_deposit_allowed: {
        Args: { p_amount_cents: number; p_user_id: string }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_max_requests: number
          p_rate_key: string
          p_window_ms: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_ms: number
        }[]
      }
      cleanup_rate_limit_counters: { Args: never; Returns: number }
      commit_tournament_field: {
        Args: { p_final_field_size: number; p_tournament_id: string }
        Returns: undefined
      }
      complete_satellite_tournament: {
        Args: { p_bubble?: Json; p_seat_winners: Json; p_tournament_id: string }
        Returns: undefined
      }
      complete_tournament: {
        Args: { p_placings: Json; p_tournament_id: string }
        Returns: undefined
      }
      create_tournament_round: {
        Args: {
          p_pairings: Json
          p_round_number: number
          p_tournament_id: string
        }
        Returns: string
      }
      enter_tournament: {
        Args: {
          p_redeem_points?: number
          p_tournament_id: string
          p_user_id: string
        }
        Returns: string
      }
      file_match_dispute: {
        Args: { p_match_id: string; p_reason: string }
        Returns: string
      }
      hash_phone: { Args: { p_phone: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_identifier_excluded: {
        Args: { p_identifier_hash: string; p_identifier_type: string }
        Returns: boolean
      }
      is_self_excluded: { Args: { target_user_id: string }; Returns: boolean }
      list_open_disputes: {
        Args: never
        Returns: {
          adjustment_cents: number | null
          created_at: string
          filed_by_user_id: string
          id: string
          match_id: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "match_disputes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      move_balance: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_match_id?: string
          p_reason: string
          p_tournament_id?: string
          p_transaction_id?: string
          p_user_id: string
        }
        Returns: number
      }
      move_loyalty_points: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_match_id?: string
          p_reason: string
          p_tournament_id?: string
          p_user_id: string
        }
        Returns: number
      }
      realised_profit_cents: { Args: never; Returns: number }
      reconcile_orphan_reservations: {
        Args: { p_older_than?: string }
        Returns: number
      }
      record_tournament_match_result: {
        Args: {
          p_match_id?: string
          p_tournament_match_id: string
          p_winner_id: string
        }
        Returns: undefined
      }
      record_withdrawal_outcome: {
        Args: {
          p_failure_reason?: string
          p_payout_id: string
          p_status: string
          p_stripe_transfer_id: string
        }
        Returns: undefined
      }
      refund_stake: { Args: { p_reservation_id: string }; Returns: boolean }
      request_withdrawal: {
        Args: { p_amount_cents: number; p_user_id: string }
        Returns: string
      }
      reserve_stake: {
        Args: { p_amount_cents: number; p_user_id: string }
        Returns: string
      }
      resolve_match_dispute: {
        Args: {
          p_adjustment_cents?: number
          p_adjustment_user_id?: string
          p_dispute_id: string
          p_resolution_note: string
          p_status: string
        }
        Returns: undefined
      }
      settle_ranked_match: {
        Args: {
          p_duration_seconds: number
          p_elo_delta_loser: number
          p_elo_delta_winner: number
          p_fee_cents: number
          p_is_draw: boolean
          p_loser_id: string
          p_match_id: string
          p_move_sequence: string[]
          p_reason: string
          p_replay: Json
          p_reservation_1: string
          p_reservation_2: string
          p_stake_cents: number
          p_timings_1: number[]
          p_timings_2: number[]
          p_winner_id: string
          p_winner_payout_cents: number
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
