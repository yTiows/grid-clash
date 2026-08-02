"use client"

import { useState } from "react"
import { useFormState, useFormStatus } from "react-dom"

import { sendPhoneCodeAction, verifyPhoneCodeAction, type PhoneActionState } from "@/actions/phone"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: PhoneActionState = { status: "idle", message: null }

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  )
}

export function PhoneVerifyForm() {
  const [phone, setPhone] = useState("")
  const [sendState, sendAction] = useFormState(sendPhoneCodeAction, initial)
  const [verifyState, verifyAction] = useFormState(verifyPhoneCodeAction, initial)

  if (verifyState.status === "verified") {
    return <p className="text-sm font-bold text-primary">Phone verified.</p>
  }

  const codeSent = sendState.status === "sent"
  // sendPhoneCodeAction accepts however the player typed it (spaces,
  // dashes, no country code) and normalizes to E.164 server-side — this
  // syncs the client's copy to that normalized value so the verify step's
  // hidden field matches what was actually texted, not what was typed.
  const verifiedPhone = sendState.normalizedPhone ?? phone

  return (
    <div className="space-y-3">
      {!codeSent && (
        <form action={sendAction} className="flex gap-2">
          <Input
            name="phoneNumber"
            type="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1"
          />
          <SubmitButton>Send code</SubmitButton>
        </form>
      )}

      {codeSent && (
        <form action={verifyAction} className="flex gap-2">
          <input type="hidden" name="phoneNumber" value={verifiedPhone} />
          <Input name="code" placeholder="6-digit code" maxLength={6} className="flex-1" />
          <SubmitButton>Verify</SubmitButton>
        </form>
      )}

      {sendState.status === "error" && <p className="text-xs text-rival">{sendState.message}</p>}
      {verifyState.status === "error" && <p className="text-xs text-rival">{verifyState.message}</p>}
      {sendState.status === "sent" && (
        <p className="text-xs text-muted-foreground">{sendState.message}</p>
      )}
    </div>
  )
}
