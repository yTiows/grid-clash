import Link from "next/link"

import { startConnectOnboardingAction } from "@/actions/withdrawal"
import { startKycVerificationAction } from "@/actions/kyc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DepositForm } from "@/components/wallet/deposit-form"
import { PhoneVerifyForm } from "@/components/wallet/phone-verify-form"
import { WithdrawalForm } from "@/components/wallet/withdrawal-form"
import { createClient } from "@/lib/supabase/server"

function ChecklistRow({
  label,
  done,
  action,
}: {
  label: string
  done: boolean
  action: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/15 py-3.5 transition-colors last:border-0">
      <div className="flex items-center gap-2.5">
        {/* Same landed-piece spring as the board (.cell-place, globals.css)
            — a completed verification step is a small win, same language. */}
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs font-bold ${
            done
              ? "cell-place border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          {done ? "✓" : "○"}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      {done ? <Badge variant="default">Done</Badge> : action}
    </div>
  )
}

export default async function WalletPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from("users").select("*").eq("id", user.id).single()
  const { data: payouts } = await supabase
    .from("payouts")
    .select("*")
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(10)

  if (!profile) return null

  const withdrawalReady =
    profile.kyc_verified && profile.phone_verified && profile.stripe_connect_payouts_enabled

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="display text-2xl">Wallet</h1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to lobby
        </Link>
      </div>

      <Card className="foil">
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div className="text-sm font-medium uppercase tracking-wide text-gold-foreground/70">
            Current balance
          </div>
          <div className="tabular text-4xl font-black text-gold-foreground">
            ${(profile.balance_cents / 100).toFixed(2)}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deposit</CardTitle>
            <CardDescription>Funds are available immediately after payment confirms.</CardDescription>
          </CardHeader>
          <CardContent>
            <DepositForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Withdraw</CardTitle>
            <CardDescription>
              {withdrawalReady
                ? "Funds are sent to your verified payout account."
                : "Complete the steps below to unlock withdrawals."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ChecklistRow
              label="Phone verified"
              done={profile.phone_verified}
              action={<PhoneVerifyForm />}
            />
            <ChecklistRow
              label="Identity verified"
              done={profile.kyc_verified}
              action={
                <form action={startKycVerificationAction}>
                  <Button size="sm" type="submit">
                    Verify identity
                  </Button>
                </form>
              }
            />
            <ChecklistRow
              label="Payout account connected"
              done={profile.stripe_connect_payouts_enabled}
              action={
                <form action={startConnectOnboardingAction}>
                  <Button size="sm" type="submit">
                    Connect payout account
                  </Button>
                </form>
              }
            />

            {withdrawalReady && <WithdrawalForm maxCents={profile.balance_cents} />}
          </CardContent>
        </Card>
      </div>

      {payouts && payouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent withdrawals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="tabular text-muted-foreground">
                  {new Date(p.requested_at).toLocaleDateString()}
                </span>
                <span className="tabular font-semibold">${(p.amount_cents / 100).toFixed(2)}</span>
                <Badge
                  variant={
                    p.status === "paid"
                      ? "default"
                      : p.status === "failed" || p.status === "reversed"
                        ? "outline"
                        : "muted"
                  }
                >
                  {p.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="max-w-2xl text-xs text-muted-foreground">
        Deposits and withdrawals are processed by Stripe. Grid Clash never stores your card or
        bank details.
      </p>
    </div>
  )
}
