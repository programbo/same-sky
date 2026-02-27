import { motion, useReducedMotion } from "motion/react"
import NumberFlow from "@number-flow/react"
import { type CSSProperties, type FocusEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { Button, Group } from "react-aria-components"
import { createActor, type ActorRefFrom, type SnapshotFrom } from "xstate"
import { formatDecimalOffsetHours, NUMBER_FLOW_PLUGINS, type OrbitLabelLayout } from "../useHomeClockModel"
import { orbitFocusMachine } from "./orbit-focus.machine"
import { cn, labelSpoke, orbitChip, orbitEntityRow, orbitLabel } from "./homeClock.variants"

interface OrbitLabelSystemProps {
  orbitLabelLayout: OrbitLabelLayout[]
  isRingTransitioning: boolean
  selectedId: string | null
  onSelectedIdChange: (id: string) => void
  onKeyboardHelpNeeded?: () => void
}

function useOrbitFocusActor(): {
  snapshot: SnapshotFrom<typeof orbitFocusMachine>
  send: ActorRefFrom<typeof orbitFocusMachine>["send"]
} {
  const actorRef = useRef<ActorRefFrom<typeof orbitFocusMachine> | null>(null)
  if (!actorRef.current) {
    actorRef.current = createActor(orbitFocusMachine)
  }

  const [snapshot, setSnapshot] = useState<SnapshotFrom<typeof orbitFocusMachine>>(() =>
    actorRef.current!.getSnapshot(),
  )

  useEffect(() => {
    const actor = actorRef.current!
    actor.start()
    const subscription = actor.subscribe((next) => {
      setSnapshot(next)
    })

    return () => {
      subscription.unsubscribe()
      actor.stop()
    }
  }, [])

  return {
    snapshot,
    send: actorRef.current.send,
  }
}

export function OrbitLabelSystem({
  orbitLabelLayout,
  isRingTransitioning,
  selectedId,
  onSelectedIdChange,
  onKeyboardHelpNeeded,
}: OrbitLabelSystemProps) {
  const reduceMotion = useReducedMotion()
  const { snapshot, send } = useOrbitFocusActor()
  const cardRefs = useRef(new Map<string, HTMLDivElement | null>())
  const memberRefs = useRef(new Map<string, Array<HTMLButtonElement | null>>())
  const lastFocusRequestIdRef = useRef<number>(0)
  const lastSelectionRequestIdRef = useRef<number>(0)
  const lastToastRequestIdRef = useRef<number>(0)

  useEffect(() => {
    send({
      type: "SYNC_LAYOUT",
      cards: orbitLabelLayout.map((label) => ({
        cardId: label.id,
        memberIds: label.members.map((member) => member.id),
      })),
      selectedId,
    })
  }, [orbitLabelLayout, selectedId, send])

  useEffect(() => {
    const request = snapshot.context.focusRequest
    if (!request || request.requestId === lastFocusRequestIdRef.current) {
      return
    }

    lastFocusRequestIdRef.current = request.requestId
    if (request.kind === "card") {
      cardRefs.current.get(request.cardId)?.focus()
      return
    }

    const members = memberRefs.current.get(request.cardId) ?? []
    const target = members[request.memberIndex]
    target?.focus()
  }, [snapshot.context.focusRequest])

  useEffect(() => {
    const request = snapshot.context.selectionRequest
    if (!request || request.requestId === lastSelectionRequestIdRef.current) {
      return
    }

    lastSelectionRequestIdRef.current = request.requestId
    onSelectedIdChange(request.memberId)
  }, [snapshot.context.selectionRequest, onSelectedIdChange])

  useEffect(() => {
    const request = snapshot.context.toastRequest
    if (!request || request.requestId === lastToastRequestIdRef.current) {
      return
    }

    lastToastRequestIdRef.current = request.requestId
    onKeyboardHelpNeeded?.()
  }, [snapshot.context.toastRequest, onKeyboardHelpNeeded])

  const layoutById = useMemo(() => {
    return new Map(orbitLabelLayout.map((layout) => [layout.id, layout]))
  }, [orbitLabelLayout])

  const orderedLayouts = useMemo(() => {
    if (snapshot.context.cardOrder.length === 0) {
      return orbitLabelLayout
    }

    return snapshot.context.cardOrder
      .map((cardId) => layoutById.get(cardId))
      .filter((layout): layout is OrbitLabelLayout => layout !== undefined)
  }, [snapshot.context.cardOrder, orbitLabelLayout, layoutById])

  const canMoveToAdjacentCard = (cardId: string, shiftKey: boolean): boolean => {
    const cardOrder = snapshot.context.cardOrder
    const index = cardOrder.indexOf(cardId)
    if (index < 0) {
      return false
    }

    const nextIndex = shiftKey ? index - 1 : index + 1
    return nextIndex >= 0 && nextIndex < cardOrder.length
  }

  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>, cardId: string) => {
    const key = event.key

    if (key === "Tab") {
      const canMove = canMoveToAdjacentCard(cardId, event.shiftKey)
      if (canMove) {
        event.preventDefault()
      }
      send({ type: "CARD_KEY", cardId, key, shiftKey: event.shiftKey })
      return
    }

    if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault()
      send({ type: "CARD_KEY", cardId, key, shiftKey: event.shiftKey })
    }
  }

  const onMemberKeyDown = (event: KeyboardEvent<HTMLButtonElement>, cardId: string, memberIndex: number) => {
    const key = event.key

    if (key === "Tab") {
      const canMove = canMoveToAdjacentCard(cardId, event.shiftKey)
      if (canMove) {
        event.preventDefault()
      }
      send({ type: "MEMBER_KEY", cardId, memberIndex, key, shiftKey: event.shiftKey })
      return
    }

    if (
      key === "ArrowDown" ||
      key === "ArrowUp" ||
      key === "Home" ||
      key === "End" ||
      key === "Escape" ||
      key === "Enter" ||
      key === " "
    ) {
      event.preventDefault()
      send({ type: "MEMBER_KEY", cardId, memberIndex, key, shiftKey: event.shiftKey })
    }
  }

  const onFocusCapture = () => {
    send({ type: "FOCUS_ENTER_CHOOSER" })
  }

  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget
    if (!event.currentTarget.contains(nextFocusedElement)) {
      send({ type: "FOCUS_LEAVE_CHOOSER" })
    }
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-14 overflow-visible"
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      onKeyDownCapture={(event) => {
        send({ type: "KEYBOARD_INPUT", key: event.key })
      }}
      onPointerDownCapture={() => {
        send({ type: "POINTER_INPUT" })
      }}
      role="region"
      aria-label="Saved locations by 24 hour offset"
    >
      <div className="pointer-events-none absolute inset-0 z-8 overflow-visible" aria-hidden="true">
        {orderedLayouts.map((label, index) => {
          const dx = label.spokeEndX - label.anchorX
          const dy = label.spokeEndY - label.anchorY
          const length = Math.hypot(dx, dy)
          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
          return (
            <span
              key={`${label.id}-leader`}
              className="pointer-events-none absolute left-0 top-0 block overflow-visible origin-[0_50%]"
              style={{
                width: `${length}px`,
                transform: `translate(${label.anchorX}px, ${label.anchorY}px) rotate(${angleDeg}deg) translateY(-50%)`,
              }}
            >
              <motion.span
                className={labelSpoke({ selected: label.members.some((member) => member.id === selectedId) })}
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

      {orderedLayouts.map((label, index) => {
        const footerDateTime = label.shortDateTime24 ?? label.time
        const footerRelativeDeltaMinutes = label.relativeOffsetMinutes
        const footerRelativeDelta = formatDecimalOffsetHours(footerRelativeDeltaMinutes)
        const footerRelativeSign = footerRelativeDeltaMinutes >= 0 ? "+" : "-"
        const footerRelativeHours = Math.abs(footerRelativeDeltaMinutes) / 60
        const cardIsSelected = label.members.some((member) => member.id === selectedId)
        const footerOffsetLabel = cardIsSelected ? "Now" : footerRelativeDelta
        const cardFooter = `${footerDateTime} · ${footerOffsetLabel}`

        return (
          <Group
            key={label.id}
            data-orbit-card-id={label.id}
            className={cn(
              orbitLabel({ side: label.side, switching: isRingTransitioning }),
              cardIsSelected ? "z-18" : "z-10",
            )}
            style={{
              transform: `translate(${label.x}px, ${label.y}px)`,
              width: `${label.width}px`,
            }}
            title={`${cardFooter} ${label.timezoneMeta}`}
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
                className={orbitChip({ selected: cardIsSelected, local: label.isLocal })}
                style={
                  {
                    "--orbit-accent": label.skyColorHex,
                    "--orbit-row-pad-x": "0.62rem",
                    "--orbit-icon-col": "1.2rem",
                    "--orbit-row-gap": "0.6rem",
                  } as CSSProperties
                }
              >
                <div
                  ref={(node) => {
                    cardRefs.current.set(label.id, node)
                  }}
                  data-orbit-card-focus
                  data-orbit-card-focus-id={label.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${label.timezoneMeta}. Press Enter to browse locations in this timezone card.`}
                  onFocus={() => {
                    send({ type: "CARD_FOCUSED", cardId: label.id })
                  }}
                  onKeyDown={(event) => onCardKeyDown(event, label.id)}
                  className="order-1 mb-[0.14rem] rounded-[10px] border border-transparent px-[calc(var(--orbit-row-pad-x))] py-[0.18rem] text-[0.68rem] font-medium uppercase tracking-[0.08em] text-[#c8d8e5] focus-visible:outline-2 focus-visible:outline-home-focus focus-visible:outline-offset-1"
                >
                  {label.timezoneMeta}
                </div>

                <Group
                  role="presentation"
                  className="order-2 flex flex-col gap-0 p-0 text-[0.84rem] tracking-[0.03em] text-white max-[900px]:text-[0.74rem]"
                >
                  {label.members.map((member, memberIndex) => {
                    const isMemberSelected = member.id === selectedId
                    return (
                      <Button
                        key={member.id}
                        type="button"
                        data-orbit-member-button
                        data-orbit-member-id={member.id}
                        data-orbit-member-selected={isMemberSelected ? "true" : "false"}
                        className={orbitEntityRow({ selected: isMemberSelected })}
                        onPress={() => {
                          onSelectedIdChange(member.id)
                        }}
                        onFocus={() => {
                          send({ type: "MEMBER_FOCUSED", cardId: label.id, memberIndex })
                        }}
                        onKeyDown={(event) => onMemberKeyDown(event, label.id, memberIndex)}
                        // title={`${member.label} · ${member.time} (${member.relativeLabel})`}
                        // tabIndex={-1}
                        ref={(node) => {
                          const list = memberRefs.current.get(label.id) ?? []
                          list[memberIndex] = node
                          memberRefs.current.set(label.id, list)
                        }}
                      >
                        <span className="relative z-1 text-[1.12rem] leading-none" aria-hidden="true">
                          {member.leadingEmoji}
                        </span>
                        <span
                          className={cn(
                            "relative z-1 wrap-break-word font-body text-[0.96rem] font-light leading-[1.18] tracking-[0.018em] [word-break:break-word] [font-synthesis:none]",
                            isMemberSelected ? "text-[#ffd89d]" : "text-[#f5fbff]",
                          )}
                        >
                          {member.label}
                        </span>
                      </Button>
                    )
                  })}
                </Group>

                <strong className="order-3 block min-w-0 whitespace-nowrap px-[calc(var(--orbit-row-pad-x)+var(--orbit-icon-col)+var(--orbit-row-gap))] pb-[0.44rem] pt-[0.14rem] font-body text-[0.8rem] leading-[1.2] tracking-[0.025em] text-[#f0f8ff] max-[900px]:text-[0.76rem]">
                  {cardIsSelected ? (
                    <span className="font-bold text-white font-features-['lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">
                      {footerDateTime} · Now
                    </span>
                  ) : (
                    <>
                      <span className="font-bold text-white font-features-['lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">
                        {footerDateTime} · {footerRelativeSign}
                      </span>
                      <NumberFlow
                        className="font-bold text-white font-features-['lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]"
                        value={footerRelativeHours}
                        plugins={NUMBER_FLOW_PLUGINS}
                        format={{ minimumFractionDigits: 1, maximumFractionDigits: 2, useGrouping: false }}
                      />
                      <span className="font-bold text-white font-features-['lnum'_1,'tnum'_1] [font-variant-numeric:lining-nums_tabular-nums]">
                        h
                      </span>
                    </>
                  )}
                </strong>
              </Group>
            </motion.div>
          </Group>
        )
      })}
    </div>
  )
}

export default OrbitLabelSystem
