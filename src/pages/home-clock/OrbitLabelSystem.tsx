import { motion, useReducedMotion } from "motion/react"
import NumberFlow from "@number-flow/react"
import { type CSSProperties, type Dispatch, type SetStateAction } from "react"
import { Button, Group, Text } from "react-aria-components"
import { formatDecimalOffsetHours, NUMBER_FLOW_PLUGINS, type OrbitLabelLayout } from "../useHomeClockModel"
import { cn, labelSpoke, orbitChip, orbitEntityRow, orbitLabel } from "./homeClock.variants"

interface OrbitLabelSystemProps {
  orbitLabelLayout: OrbitLabelLayout[]
  isRingTransitioning: boolean
  setSelectedId: Dispatch<SetStateAction<string | null>>
}

export function OrbitLabelSystem({ orbitLabelLayout, isRingTransitioning, setSelectedId }: OrbitLabelSystemProps) {
  const reduceMotion = useReducedMotion()

  return (
    <div className="pointer-events-none absolute inset-0 z-[14] overflow-visible" role="listbox" aria-label="Saved locations by 24 hour offset">
      <div className="pointer-events-none absolute inset-0 z-[8] overflow-visible" aria-hidden="true">
        {orbitLabelLayout.map((label, index) => {
          const dx = label.spokeEndX - label.anchorX
          const dy = label.spokeEndY - label.anchorY
          const length = Math.hypot(dx, dy)
          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
          return (
            <span
              key={`${label.id}-leader`}
              className="pointer-events-none absolute left-0 top-0 block overflow-visible [transform-origin:0_50%]"
              style={{
                width: `${length}px`,
                transform: `translate(${label.anchorX}px, ${label.anchorY}px) rotate(${angleDeg}deg) translateY(-50%)`,
              }}
            >
              <motion.span
                className={labelSpoke({ selected: label.isSelected })}
                initial={reduceMotion ? false : { scaleX: 0, opacity: 0.65 }}
                animate={reduceMotion ? undefined : { scaleX: 1, opacity: 1 }}
                transition={
                  reduceMotion
                    ? undefined
                    : {
                        duration: 0.34,
                        delay: index * 0.06 + 0.44,
                        ease: [0.22, 1, 0.36, 1],
                      }
                }
                style={{
                  width: "100%",
                  transformOrigin: "100% 50%",
                  willChange: "transform, opacity",
                }}
              />
            </span>
          )
        })}
      </div>

      {orbitLabelLayout.map((label, index) => {
        const primarySelectionId = label.members.find((member) => member.isSelected)?.id ?? label.members[0]?.id
        const footerDateTime = label.shortDateTime24 ?? label.time
        const footerRelativeDeltaMinutes = label.relativeOffsetMinutes
        const footerRelativeDelta = formatDecimalOffsetHours(footerRelativeDeltaMinutes)
        const footerRelativeSign = footerRelativeDeltaMinutes >= 0 ? "+" : "-"
        const footerRelativeHours = Math.abs(footerRelativeDeltaMinutes) / 60
        const footerOffsetLabel = label.isSelected ? "Now" : footerRelativeDelta
        const cardFooter = `${footerDateTime} · ${footerOffsetLabel}`
        return (
          <Group
            key={label.id}
            data-orbit-card-id={label.id}
            role="group"
            aria-selected={label.isSelected}
            aria-label={`${cardFooter} ${label.timezoneMeta}`}
            className={cn(orbitLabel({ side: label.side, switching: isRingTransitioning }), label.isSelected ? "z-[18]" : "z-[10]")}
            style={{
              transform: `translate(${label.x}px, ${label.y}px)`,
              width: `${label.width}px`,
            }}
            title={`${cardFooter} ${label.timezoneMeta}`}
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
            <motion.div
              className="will-change-[opacity,transform,filter]"
              initial={reduceMotion ? false : { opacity: 0, y: 16, filter: "blur(10px)" }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={
                reduceMotion
                  ? undefined
                  : {
                      duration: 0.48,
                      delay: index * 0.06,
                      ease: [0.22, 1, 0.36, 1],
                      filter: { duration: 0.36, ease: "easeOut" },
                    }
              }
            >
              <Group
                role="presentation"
                className={orbitChip({ selected: label.isSelected, local: label.isLocal })}
                style={
                  {
                    "--orbit-accent": label.skyColorHex,
                    "--orbit-row-pad-x": "0.62rem",
                    "--orbit-icon-col": "1.2rem",
                    "--orbit-row-gap": "0.6rem",
                  } as CSSProperties
                }
              >
                <Group
                  role="presentation"
                  className="order-1 flex flex-col gap-0 p-0 text-[0.84rem] tracking-[0.03em] text-white max-[900px]:text-[0.74rem]"
                >
                  {label.members.map((member) => {
                    return (
                      <Button
                        key={member.id}
                        type="button"
                        data-orbit-member-button
                        data-orbit-member-id={member.id}
                        data-orbit-member-selected={member.isSelected ? "true" : "false"}
                        className={orbitEntityRow({ selected: member.isSelected })}
                        onPress={() => {
                          setSelectedId(member.id)
                        }}
                        title={`${member.label} · ${member.time} (${member.relativeLabel})`}
                      >
                        <Text elementType="span" className="relative z-[1] text-[1.12rem] leading-none" aria-hidden="true">
                          {member.leadingEmoji}
                        </Text>
                        <Text
                          elementType="span"
                          className={cn(
                            "relative z-[1] break-words font-body text-[0.96rem] font-light leading-[1.18] tracking-[0.018em] [overflow-wrap:anywhere] [word-break:break-word] [font-synthesis:none]",
                            member.isSelected ? "text-[#ffd89d]" : "text-[#f5fbff]",
                          )}
                        >
                          {member.label}
                        </Text>
                      </Button>
                    )
                  })}
                </Group>
                <Text
                  elementType="strong"
                  className="order-2 block min-w-0 whitespace-nowrap px-[calc(var(--orbit-row-pad-x)+var(--orbit-icon-col)+var(--orbit-row-gap))] pb-[0.44rem] pt-[0.14rem] font-body text-[0.8rem] leading-[1.2] tracking-[0.025em] text-[#f0f8ff] max-[900px]:text-[0.76rem]"
                >
                  {label.isSelected ? (
                    <span className="font-bold text-white [font-feature-settings:'lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">
                      {footerDateTime} · Now
                    </span>
                  ) : (
                    <>
                      <span className="font-bold text-white [font-feature-settings:'lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">
                        {footerDateTime} · {footerRelativeSign}
                      </span>
                      <NumberFlow
                        className="font-bold text-white [font-feature-settings:'lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]"
                        value={footerRelativeHours}
                        plugins={NUMBER_FLOW_PLUGINS}
                        format={{ minimumFractionDigits: 1, maximumFractionDigits: 2, useGrouping: false }}
                      />
                      <span className="font-bold text-white [font-feature-settings:'lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">
                        h
                      </span>
                    </>
                  )}
                </Text>
              </Group>
            </motion.div>
          </Group>
        )
      })}
    </div>
  )
}

export default OrbitLabelSystem
