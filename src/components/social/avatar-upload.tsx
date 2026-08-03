"use client"

import { useRef, useState, useTransition } from "react"

import { updateAvatarUrlAction } from "@/actions/profile"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

const MAX_BYTES = 2 * 1024 * 1024 // 2MB — a profile picture, not an asset upload service.
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"]

/**
 * Uploads straight to Storage from the browser (avatars_insert_own RLS
 * scopes this to the caller's own userId/ folder — see
 * 20260801000006_social_tab.sql), then calls a server action only to
 * persist the resulting public URL onto users.avatar_url, since that write
 * needs the service-role client like every other users-table mutation here.
 */
export function AvatarUpload({
  userId,
  username,
  currentUrl,
}: {
  userId: string
  username: string
  currentUrl: string | null
}) {
  const [avatarUrl, setAvatarUrl] = useState(currentUrl)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    setError(null)

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("PNG, JPEG, or WEBP only.")
      return
    }
    if (file.size > MAX_BYTES) {
      setError("2MB max.")
      return
    }

    startTransition(async () => {
      const supabase = createClient()
      const extension = file.type.split("/")[1]
      const path = `${userId}/avatar.${extension}`

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" })

      if (uploadError) {
        setError("Upload failed. Try again.")
        return
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path)
      // Cache-bust: the path is stable (always avatar.<ext>), so a browser
      // that already cached the old image needs a reason to refetch it.
      const bustedUrl = `${publicUrl}?v=${Date.now()}`

      const result = await updateAvatarUrlAction(bustedUrl, username)
      if (result.status === "error") {
        setError(result.message)
        return
      }

      setAvatarUrl(bustedUrl)
    })
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="group relative h-20 w-20 overflow-hidden rounded-full border-2 border-border bg-white/[0.06]"
        aria-label="Change avatar"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Storage URL, not a static asset next/image can optimise usefully.
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground">
            {username.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs font-bold opacity-0 transition-opacity group-hover:opacity-100">
          {pending ? "…" : "Change"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ""
        }}
      />
      {error && <p className="text-xs text-rival">{error}</p>}
      {!avatarUrl && !error && (
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Upload photo
        </Button>
      )}
    </div>
  )
}
