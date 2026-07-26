"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        gold: "foil",
        rival: "bg-rival text-rival-foreground",
        outline: "border-white/20 bg-transparent text-foreground",
        muted: "border-white/10 bg-secondary text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
