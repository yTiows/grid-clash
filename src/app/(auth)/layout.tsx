import Link from "next/link"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-2xl font-semibold tracking-tight text-primary">
        Grid Clash
      </Link>
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  )
}
