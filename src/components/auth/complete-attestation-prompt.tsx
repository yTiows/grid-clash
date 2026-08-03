"use client"

import { useFormState, useFormStatus } from "react-dom"

import { completeAttestationAction, type AuthActionState } from "@/actions/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: AuthActionState = { status: "idle", message: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Confirm"}
    </Button>
  )
}

/**
 * Shown on the dashboard when an account is missing date_of_birth_self_
 * attested/terms_accepted_at — the fallback path for the two real accounts
 * caught by signUpAction's now-fixed bug (2026-08-01), where this was
 * silently never saved. Until this is filled in, assert_can_wager/
 * check_deposit_allowed refuse every paid action outright, so this sits
 * above everything else on the page rather than being easy to miss.
 */
export function CompleteAttestationPrompt() {
  const [state, formAction] = useFormState(completeAttestationAction, initial)

  if (state.status === "success") {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="py-4 text-sm font-medium text-primary">
          Saved — reload the page to continue.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-rival/40 bg-rival/5">
      <CardHeader>
        <CardTitle className="text-base">One more thing before you can stake or deposit</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            We need your date of birth and terms acceptance on file — this didn&apos;t save when you
            signed up.
          </p>

          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input id="dateOfBirth" name="dateOfBirth" type="date" required />
            {state.fieldErrors?.dateOfBirth && (
              <p className="text-sm text-rival">{state.fieldErrors.dateOfBirth[0]}</p>
            )}
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
        </form>
      </CardContent>
    </Card>
  )
}
