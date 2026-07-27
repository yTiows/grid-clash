import type { Metadata } from "next"

import { SignupForm } from "@/components/auth/signup-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FEE_TIERS } from "@/lib/game/fees"

export const metadata: Metadata = { title: "Sign up — Grid Clash" }

// Same stale-rate class of bug already found on the landing page and root
// layout — derived from FEE_TIERS.standard so this can't drift again either.
const standardFeePercent = (FEE_TIERS.standard.bps / 100).toFixed(0)

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>{standardFeePercent}% fee on ranked. No purchase necessary to play.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
    </Card>
  )
}
