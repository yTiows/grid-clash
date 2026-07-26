import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/types/database.types"

/**
 * Service-role client. Bypasses RLS entirely.
 * Only for trusted server contexts that have already authorized the caller:
 * webhook handlers, the match settlement engine, scheduled jobs.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
