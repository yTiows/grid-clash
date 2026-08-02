"use client"

import Link from "next/link"
import { useFormState, useFormStatus } from "react-dom"

import { signUpAction, type AuthActionState } from "@/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  )
}

const initialState: AuthActionState = { status: "idle", message: null }

export function SignupForm() {
  const [state, formAction] = useFormState(signUpAction, initialState)

  if (state.status === "success") {
    return (
      <div className="space-y-2 text-center">
        <p className="font-bold">Check your inbox</p>
        <p className="text-sm text-muted-foreground">{state.message}</p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        {state.fieldErrors?.email && (
          <p className="text-sm text-rival">{state.fieldErrors.email[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {state.fieldErrors?.password && (
          <p className="text-sm text-rival">{state.fieldErrors.password[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="dateOfBirth">Date of birth</Label>
        <Input id="dateOfBirth" name="dateOfBirth" type="date" required />
        {state.fieldErrors?.dateOfBirth && (
          <p className="text-sm text-rival">{state.fieldErrors.dateOfBirth[0]}</p>
        )}
        <p className="text-xs text-muted-foreground">
          You must be 18+ to enter paid contests. Verified again before withdrawal.
        </p>
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="acceptedTerms"
          required
          className="mt-0.5 h-4 w-4 rounded border border-border bg-transparent accent-[color:var(--primary)]"
        />
        <span>
          I&apos;m 18+, and I agree matches are for entertainment, not a source of income.
          Results are determined by skill. Deposit limits and self-exclusion are available on
          my account at any time, and no purchase is necessary to play.
        </span>
      </label>
      {state.fieldErrors?.acceptedTerms && (
        <p className="text-sm text-rival">{state.fieldErrors.acceptedTerms[0]}</p>
      )}

      {state.status === "error" && !state.fieldErrors && (
        <p className="text-sm text-rival">{state.message}</p>
      )}

      <SubmitButton />

      <p className="text-center text-sm text-muted-foreground">
        Already playing?{" "}
        <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  )
}
