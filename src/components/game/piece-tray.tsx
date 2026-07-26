"use client"

import type { Inventory, PieceKind } from "@/lib/game/engine"

const PIECE_META: Record<PieceKind, { label: string; icon: string; hint: string }> = {
  normal: { label: "Place", icon: "●", hint: "Occupy an empty cell" },
  shield: { label: "Shield", icon: "◆", hint: "Placed cell can't be bombed or swapped" },
  bomb: { label: "Bomb", icon: "✕", hint: "Clear an unshielded opponent cell" },
  swap: { label: "Swap", icon: "⇄", hint: "Trade an unshielded cell with an opponent's" },
}

export function PieceTray({
  inventory,
  selected,
  onSelect,
  disabled,
}: {
  inventory: Inventory
  selected: PieceKind
  onSelect: (kind: PieceKind) => void
  disabled: boolean
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {(Object.keys(PIECE_META) as PieceKind[]).map((kind) => {
        const meta = PIECE_META[kind]
        const count = inventory[kind]
        const isSelected = selected === kind
        const isDisabled = disabled || count <= 0

        return (
          <button
            key={kind}
            type="button"
            title={meta.hint}
            disabled={isDisabled}
            onClick={() => onSelect(kind)}
            className={`sticker flex flex-col items-center gap-0.5 py-2 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
              isSelected ? "bg-primary text-primary-foreground" : "hover:bg-white/5"
            }`}
          >
            <span className="text-lg leading-none">{meta.icon}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide">{meta.label}</span>
            <span className="tabular text-xs font-bold">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
