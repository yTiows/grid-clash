import { z } from "zod"

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // 72-byte ceiling matches bcrypt's limit (used by Supabase Auth/GoTrue).
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
  dateOfBirth: z
    .string()
    .refine((v) => {
      const dob = new Date(v)
      if (Number.isNaN(dob.getTime())) return false
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      return age >= 18
    }, "You must be 18 or older to enter paid contests"),
  acceptedTerms: z.literal("on", {
    errorMap: () => ({ message: "You must accept the terms to continue" }),
  }),
  // Optional: another player's username. Attribution only (users.invited_by_
  // user_id) — no reward/payout mechanics, see 20260801000006_social_tab.sql.
  // Empty string means "no referral," not a validation failure.
  referredBy: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v) => (v ? v : undefined)),
})

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
