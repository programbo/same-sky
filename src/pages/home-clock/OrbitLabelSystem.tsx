import type React from "react"
import { formatRelativeOffsetDirectionLabel, type OrbitLabelLayout } from "../useHomeClockModel"
import { cn, labelSpoke, orbitChip, orbitEntityRow, orbitLabel } from "./homeClock.variants"

interface OrbitLabelSystemProps {
  orbitLabelLayout: OrbitLabelLayout[]
  isRingTransitioning: boolean
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
}

export function OrbitLabelSystem({ orbitLabelLayout, isRingTransitioning, setSelectedId }: OrbitLabelSystemProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[14] overflow-visible" role="listbox" aria-label="Saved locations by 24 hour offset">
      <div className="pointer-events-none absolute inset-0 z-[8] overflow-visible" aria-hidden="true">
        {orbitLabelLayout.map((label) => {
          const dx = label.spokeEndX - label.anchorX
          const dy = label.spokeEndY - label.anchorY
          const length = Math.hypot(dx, dy)
          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
          return (
            <span
              key={`${label.id}-leader`}
              className={labelSpoke({ selected: label.isSelected })}
              style={{
                width: `${length}px`,
                transform: `translate(${label.anchorX}px, ${label.anchorY}px) rotate(${angleDeg}deg)`,
              }}
            />
          )
        })}
      </div>

      {orbitLabelLayout.map((label) => {
        const primarySelectionId = label.members.find((member) => member.isSelected)?.id ?? label.members[0]?.id
        const offsetSuffix = label.isSelected ? "" : formatRelativeOffsetDirectionLabel(label.relativeOffsetMinutes)
        const timeWithOffset = offsetSuffix ? `${label.time} ${offsetSuffix}` : label.time
        return (
          <div
            key={label.id}
            role="option"
            aria-selected={label.isSelected}
            aria-label={`${timeWithOffset} ${label.timezoneMeta}`}
            className={cn(orbitLabel({ side: label.side, switching: isRingTransitioning }), label.isSelected ? "z-[18]" : "z-[10]")}
            style={{
              transform: `translate(${label.x}px, ${label.y}px)`,
              width: `${label.width}px`,
            }}
            title={`${timeWithOffset} ${label.timezoneMeta}`}
            tabIndex={0}
            onClick={() => {
              if (primarySelectionId) {
                setSelectedId(primarySelectionId)
              }
            }}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && primarySelectionId) {
                event.preventDefault()
                setSelectedId(primarySelectionId)
              }
            }}
          >
            <span
              className={orbitChip({ selected: label.isSelected, local: label.isLocal })}
              style={
                {
                  "--orbit-accent": label.skyColorHex,
                  "--orbit-row-pad-x": "0.62rem",
                  "--orbit-icon-col": "1.2rem",
                  "--orbit-row-gap": "0.6rem",
                } as React.CSSProperties
              }
            >
              <em className="order-1 flex flex-col gap-[0.26rem] p-0 text-[0.84rem] not-italic tracking-[0.03em] text-white max-[900px]:text-[0.74rem]">
                {label.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={orbitEntityRow({ selected: member.isSelected })}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedId(member.id)
                    }}
                    title={`${member.label} · ${member.time} (${member.relativeLabel})`}
                  >
                    <span className="mt-[0.12rem] text-[1.12rem] leading-none" aria-hidden="true">
                      {member.leadingEmoji}
                    </span>
                    <span className="break-words font-body text-[0.96rem] font-light leading-[1.18] tracking-[0.018em] text-[#f5fbff] [overflow-wrap:anywhere] [word-break:break-word] [font-synthesis:none]">
                      {member.label}
                    </span>
                  </button>
                ))}
              </em>
              <strong className="order-2 block min-w-0 whitespace-nowrap px-[calc(var(--orbit-row-pad-x)+var(--orbit-icon-col)+var(--orbit-row-gap))] pb-[0.48rem] pt-[0.1rem] font-body text-[0.8rem] leading-[1.2] tracking-[0.025em] text-[#f0f8ff] max-[900px]:text-[0.76rem]">
                <span className="font-bold text-white [font-feature-settings:'lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">{label.time}</span>
                {!label.isSelected ? <span className="ml-[0.3rem] font-semibold text-[#e5f1ff] opacity-95">{offsetSuffix}</span> : null}
              </strong>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default OrbitLabelSystem
