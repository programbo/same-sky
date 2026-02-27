import { assign, setup } from "xstate"
import { isKeyboardNavigationTriggerKey } from "./keyboardHelpToast"

export interface OrbitFocusCardInput {
  cardId: string
  memberIds: string[]
}

interface FocusCardRequest {
  kind: "card"
  cardId: string
  requestId: number
}

interface FocusMemberRequest {
  kind: "member"
  cardId: string
  memberIndex: number
  requestId: number
}

type FocusRequest = FocusCardRequest | FocusMemberRequest

interface SelectionRequest {
  memberId: string
  requestId: number
}

interface ToastRequest {
  requestId: number
}

interface OrbitFocusContext {
  cardOrder: string[]
  membersByCard: Record<string, string[]>
  focusedCardId: string | null
  focusedMemberIndexByCard: Record<string, number>
  selectedId: string | null
  isKeyboardModality: boolean
  isChooserFocusWithin: boolean
  requestSeq: number
  focusRequest: FocusRequest | null
  selectionRequest: SelectionRequest | null
  toastRequest: ToastRequest | null
}

type OrbitFocusEvent =
  | { type: "SYNC_LAYOUT"; cards: OrbitFocusCardInput[]; selectedId: string | null }
  | { type: "FOCUS_ENTER_CHOOSER" }
  | { type: "FOCUS_LEAVE_CHOOSER" }
  | { type: "CARD_FOCUSED"; cardId: string }
  | { type: "CARD_KEY"; cardId: string; key: string; shiftKey: boolean }
  | { type: "MEMBER_FOCUSED"; cardId: string; memberIndex: number }
  | { type: "MEMBER_KEY"; cardId: string; memberIndex: number; key: string; shiftKey: boolean }
  | { type: "POINTER_INPUT" }
  | { type: "KEYBOARD_INPUT"; key: string }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hasMembers(context: OrbitFocusContext, cardId: string): boolean {
  return (context.membersByCard[cardId]?.length ?? 0) > 0
}

function findMemberIndexById(memberIds: string[], memberId: string | null): number {
  if (!memberId) {
    return -1
  }
  return memberIds.findIndex((id) => id === memberId)
}

function getInitialMemberIndex(context: OrbitFocusContext, cardId: string, key: string): number {
  const memberIds = context.membersByCard[cardId] ?? []
  if (memberIds.length === 0) {
    return 0
  }

  if (key === "ArrowUp") {
    return memberIds.length - 1
  }

  const selectedMemberIndex = findMemberIndexById(memberIds, context.selectedId)
  if (selectedMemberIndex >= 0) {
    return selectedMemberIndex
  }

  const remembered = context.focusedMemberIndexByCard[cardId]
  if (remembered !== undefined) {
    return clamp(remembered, 0, memberIds.length - 1)
  }

  return 0
}

function withNextRequestId(context: OrbitFocusContext): number {
  return context.requestSeq + 1
}

function setFocusCardRequest(context: OrbitFocusContext, cardId: string): FocusCardRequest {
  return {
    kind: "card",
    cardId,
    requestId: withNextRequestId(context),
  }
}

function setFocusMemberRequest(context: OrbitFocusContext, cardId: string, memberIndex: number): FocusMemberRequest {
  return {
    kind: "member",
    cardId,
    memberIndex,
    requestId: withNextRequestId(context),
  }
}

function getNextCardId(context: OrbitFocusContext, cardId: string, direction: 1 | -1): string | null {
  const index = context.cardOrder.indexOf(cardId)
  if (index < 0) {
    return null
  }
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= context.cardOrder.length) {
    return null
  }
  return context.cardOrder[nextIndex] ?? null
}

function getBoundaryCardId(context: OrbitFocusContext, boundary: "first" | "last"): string | null {
  if (context.cardOrder.length === 0) {
    return null
  }
  return boundary === "first" ? context.cardOrder[0] ?? null : context.cardOrder[context.cardOrder.length - 1] ?? null
}

export const orbitFocusMachine = setup({
  types: {
    context: {} as OrbitFocusContext,
    events: {} as OrbitFocusEvent,
  },
  guards: {
    hasCards: ({ context }) => context.cardOrder.length > 0,
    hasMembersInCard: ({ context }, params: { cardId: string }) => hasMembers(context, params.cardId),
  },
  actions: {
    syncLayoutOrder: assign(({ context, event }) => {
      if (event.type !== "SYNC_LAYOUT") {
        return {}
      }

      const nextMembersByCard: Record<string, string[]> = {}
      for (const card of event.cards) {
        nextMembersByCard[card.cardId] = [...card.memberIds]
      }

      const currentOrder = context.cardOrder
      const incomingOrder = event.cards.map((card) => card.cardId)
      const retained = currentOrder.filter((id) => nextMembersByCard[id] !== undefined)
      const appended = incomingOrder.filter((id) => !retained.includes(id))
      const nextCardOrder = [...retained, ...appended]

      const nextFocusedMemberIndexByCard: Record<string, number> = {}
      for (const cardId of nextCardOrder) {
        const memberIds = nextMembersByCard[cardId] ?? []
        const previous = context.focusedMemberIndexByCard[cardId] ?? 0
        nextFocusedMemberIndexByCard[cardId] =
          memberIds.length > 0 ? clamp(previous, 0, memberIds.length - 1) : 0
      }

      let nextFocusedCardId = context.focusedCardId
      if (!nextFocusedCardId || !nextCardOrder.includes(nextFocusedCardId)) {
        nextFocusedCardId = nextCardOrder[0] ?? null
      }

      return {
        cardOrder: nextCardOrder,
        membersByCard: nextMembersByCard,
        focusedCardId: nextFocusedCardId,
        focusedMemberIndexByCard: nextFocusedMemberIndexByCard,
        selectedId: event.selectedId,
      }
    }),
    setKeyboardModalityFromKey: assign(({ context, event }) => {
      if (event.type !== "KEYBOARD_INPUT" || !isKeyboardNavigationTriggerKey(event.key)) {
        return {}
      }
      return { isKeyboardModality: true, requestSeq: context.requestSeq + 1 }
    }),
    setPointerModality: assign({ isKeyboardModality: () => false }),
    setFocusWithin: assign({ isChooserFocusWithin: () => true }),
    clearFocusWithin: assign({ isChooserFocusWithin: () => false }),
    setFocusedCard: assign(({ event }) => {
      if (event.type !== "CARD_FOCUSED") {
        return {}
      }
      return { focusedCardId: event.cardId }
    }),
    setFocusedMember: assign(({ context, event }) => {
      if (event.type !== "MEMBER_FOCUSED") {
        return {}
      }

      const memberIds = context.membersByCard[event.cardId] ?? []
      const boundedIndex = memberIds.length > 0 ? clamp(event.memberIndex, 0, memberIds.length - 1) : 0
      return {
        focusedCardId: event.cardId,
        focusedMemberIndexByCard: {
          ...context.focusedMemberIndexByCard,
          [event.cardId]: boundedIndex,
        },
      }
    }),
    requestFocusCurrentOrFirstCard: assign(({ context }) => {
      const cardId = context.focusedCardId ?? context.cardOrder[0] ?? null
      if (!cardId) {
        return {}
      }
      return {
        focusedCardId: cardId,
        focusRequest: setFocusCardRequest(context, cardId),
        requestSeq: withNextRequestId(context),
      }
    }),
    requestToastWhenKeyboard: assign(({ context }) => {
      if (!context.isKeyboardModality) {
        return {}
      }
      const nextId = withNextRequestId(context)
      return {
        toastRequest: { requestId: nextId },
        requestSeq: nextId,
      }
    }),
    drillIntoCard: assign(({ context, event }) => {
      if (event.type !== "CARD_KEY") {
        return {}
      }
      if (!hasMembers(context, event.cardId)) {
        return {}
      }
      const memberIndex = getInitialMemberIndex(context, event.cardId, event.key)
      const nextId = withNextRequestId(context)
      return {
        focusedCardId: event.cardId,
        focusedMemberIndexByCard: {
          ...context.focusedMemberIndexByCard,
          [event.cardId]: memberIndex,
        },
        focusRequest: {
          kind: "member" as const,
          cardId: event.cardId,
          memberIndex,
          requestId: nextId,
        },
        requestSeq: nextId,
      }
    }),
    moveCardFocusByTab: assign(({ context, event }) => {
      if (event.type !== "CARD_KEY") {
        return {}
      }
      const nextCardId = getNextCardId(context, event.cardId, event.shiftKey ? -1 : 1)
      if (!nextCardId) {
        return {}
      }
      const nextId = withNextRequestId(context)
      return {
        focusedCardId: nextCardId,
        focusRequest: {
          kind: "card" as const,
          cardId: nextCardId,
          requestId: nextId,
        },
        requestSeq: nextId,
      }
    }),
    moveCardFocusBoundary: assign(({ context, event }) => {
      if (event.type !== "CARD_KEY") {
        return {}
      }
      const boundary = event.key === "Home" ? "first" : "last"
      const targetCardId = getBoundaryCardId(context, boundary)
      if (!targetCardId) {
        return {}
      }
      const nextId = withNextRequestId(context)
      return {
        focusedCardId: targetCardId,
        focusRequest: {
          kind: "card" as const,
          cardId: targetCardId,
          requestId: nextId,
        },
        requestSeq: nextId,
      }
    }),
    moveMemberFocus: assign(({ context, event }) => {
      if (event.type !== "MEMBER_KEY") {
        return {}
      }
      const memberIds = context.membersByCard[event.cardId] ?? []
      if (memberIds.length === 0) {
        return {}
      }

      let nextIndex = event.memberIndex
      if (event.key === "ArrowDown") {
        nextIndex = clamp(event.memberIndex + 1, 0, memberIds.length - 1)
      } else if (event.key === "ArrowUp") {
        nextIndex = clamp(event.memberIndex - 1, 0, memberIds.length - 1)
      } else if (event.key === "Home") {
        nextIndex = 0
      } else if (event.key === "End") {
        nextIndex = memberIds.length - 1
      } else {
        return {}
      }

      const nextId = withNextRequestId(context)
      return {
        focusedMemberIndexByCard: {
          ...context.focusedMemberIndexByCard,
          [event.cardId]: nextIndex,
        },
        focusRequest: {
          kind: "member" as const,
          cardId: event.cardId,
          memberIndex: nextIndex,
          requestId: nextId,
        },
        requestSeq: nextId,
      }
    }),
    returnToCardFromLocations: assign(({ context, event }) => {
      if (event.type !== "MEMBER_KEY") {
        return {}
      }
      const nextId = withNextRequestId(context)
      return {
        focusedCardId: event.cardId,
        focusRequest: {
          kind: "card" as const,
          cardId: event.cardId,
          requestId: nextId,
        },
        requestSeq: nextId,
      }
    }),
    moveCardFromLocationsByTab: assign(({ context, event }) => {
      if (event.type !== "MEMBER_KEY") {
        return {}
      }
      const nextCardId = getNextCardId(context, event.cardId, event.shiftKey ? -1 : 1)
      if (!nextCardId) {
        return {}
      }
      const nextId = withNextRequestId(context)
      return {
        focusedCardId: nextCardId,
        focusRequest: {
          kind: "card" as const,
          cardId: nextCardId,
          requestId: nextId,
        },
        requestSeq: nextId,
      }
    }),
    commitSelection: assign(({ context, event }) => {
      if (event.type !== "MEMBER_KEY") {
        return {}
      }
      const memberIds = context.membersByCard[event.cardId] ?? []
      const memberId = memberIds[event.memberIndex]
      if (!memberId) {
        return {}
      }
      const nextId = withNextRequestId(context)
      return {
        selectionRequest: {
          memberId,
          requestId: nextId,
        },
        selectedId: memberId,
        requestSeq: nextId,
      }
    }),
  },
}).createMachine({
  id: "orbitFocus",
  context: {
    cardOrder: [],
    membersByCard: {},
    focusedCardId: null,
    focusedMemberIndexByCard: {},
    selectedId: null,
    isKeyboardModality: false,
    isChooserFocusWithin: false,
    requestSeq: 0,
    focusRequest: null,
    selectionRequest: null,
    toastRequest: null,
  },
  initial: "idle",
  on: {
    SYNC_LAYOUT: {
      actions: "syncLayoutOrder",
    },
    KEYBOARD_INPUT: {
      actions: "setKeyboardModalityFromKey",
    },
    POINTER_INPUT: {
      actions: "setPointerModality",
    },
  },
  states: {
    idle: {
      on: {
        FOCUS_ENTER_CHOOSER: {
          guard: "hasCards",
          target: "cards",
          actions: ["setFocusWithin", "requestToastWhenKeyboard", "requestFocusCurrentOrFirstCard"],
        },
      },
    },
    cards: {
      on: {
        FOCUS_LEAVE_CHOOSER: {
          target: "idle",
          actions: "clearFocusWithin",
        },
        CARD_FOCUSED: {
          actions: "setFocusedCard",
        },
        CARD_KEY: [
          {
            guard: ({ context, event }) =>
              event.type === "CARD_KEY" &&
              (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") &&
              hasMembers(context, event.cardId),
            actions: "drillIntoCard",
            target: "locations",
          },
          {
            guard: ({ event }) => event.type === "CARD_KEY" && event.key === "Tab",
            actions: "moveCardFocusByTab",
          },
          {
            guard: ({ event }) => event.type === "CARD_KEY" && (event.key === "Home" || event.key === "End"),
            actions: "moveCardFocusBoundary",
          },
        ],
      },
    },
    locations: {
      on: {
        FOCUS_LEAVE_CHOOSER: {
          target: "idle",
          actions: "clearFocusWithin",
        },
        MEMBER_FOCUSED: {
          actions: "setFocusedMember",
        },
        MEMBER_KEY: [
          {
            guard: ({ event }) => event.type === "MEMBER_KEY" && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End"),
            actions: "moveMemberFocus",
          },
          {
            guard: ({ event }) => event.type === "MEMBER_KEY" && (event.key === "Enter" || event.key === " "),
            actions: "commitSelection",
          },
          {
            guard: ({ event }) => event.type === "MEMBER_KEY" && event.key === "Escape",
            target: "cards",
            actions: "returnToCardFromLocations",
          },
          {
            guard: ({ event }) => event.type === "MEMBER_KEY" && event.key === "Tab",
            target: "cards",
            actions: "moveCardFromLocationsByTab",
          },
        ],
      },
    },
  },
})
