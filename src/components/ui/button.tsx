"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-2 border-ink bg-primary text-primary-foreground shadow-[4px_4px_0_0_var(--ink)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--ink)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_0_var(--ink)]",
        rival:
          "border-2 border-ink bg-rival text-rival-foreground shadow-[4px_4px_0_0_var(--ink)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--ink)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_0_var(--ink)]",
        gold: "border-2 border-ink bg-gold text-gold-foreground shadow-[4px_4px_0_0_var(--ink)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--ink)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_0_var(--ink)]",
        destructive:
          "border-2 border-ink bg-destructive text-destructive-foreground shadow-[4px_4px_0_0_var(--ink)] hover:-translate-x-0.5 hover:-translate-y-0.5",
        outline:
          "border-2 border-white/20 bg-transparent text-foreground hover:border-white/40 hover:bg-white/5",
        ghost: "text-foreground hover:bg-white/5",
        link: "text-primary underline-offset-4 hover:underline normal-case font-medium",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-14 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
