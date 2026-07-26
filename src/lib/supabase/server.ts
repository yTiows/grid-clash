import "server-only"

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { cookies } from "next/headers"

import type { Database } from "@/lib/types/database.types"

/** Anon-key client bound to request cookies. Subject to RLS. */
export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component render; middleware refreshes the cookie instead.
          }
        },
      },
    }
  )
}
