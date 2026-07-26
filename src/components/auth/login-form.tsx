"use client"

import Link from "next/link"
import { useFormState, useFormStatus } from "react-dom"

import { signInAction, type AuthActionState } from "@/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? "Logging in…" : "Log in"}
    </Button>
  )
}

const initialState: AuthActionState = { status: "idle", message: null }

export function LoginForm() {
  const [state, formAction] = useFormState(signInAction, initialState)

  return (
    <form action={formAction} className="space-y-5" noValidate>
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
          autoComplete="current-password"
          required
        />
        {state.fieldErrors?.password && (
          <p className="text-sm text-rival">{state.fieldErrors.password[0]}</p>
        )}
      </div>

      {state.status === "error" && !state.fieldErrors && (
        <p className="text-sm text-rival">{state.message}</p>
      )}

      <SubmitButton />

      <p className="text-center text-sm text-muted-foreground">
        New to Grid Clash?{" "}
        <Link href="/signup" className="font-semibold text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  )
}
