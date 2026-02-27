import { describe, expect, test } from "bun:test"
import { createActor } from "xstate"
import { orbitFocusMachine } from "./orbit-focus.machine"

function startMachine() {
  const actor = createActor(orbitFocusMachine)
  actor.start()
  return actor
}

describe("orbitFocusMachine", () => {
  test("SYNC_LAYOUT preserves stable card order across re-layout", () => {
    const actor = startMachine()

    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "b", memberIds: ["b-0"] },
        { cardId: "a", memberIds: ["a-0"] },
      ],
      selectedId: "a-0",
    })
    expect(actor.getSnapshot().context.cardOrder).toEqual(["b", "a"])

    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "a", memberIds: ["a-0"] },
        { cardId: "b", memberIds: ["b-0"] },
        { cardId: "c", memberIds: ["c-0"] },
      ],
      selectedId: "a-0",
    })
    expect(actor.getSnapshot().context.cardOrder).toEqual(["b", "a", "c"])
  })

  test("Tab moves adjacent cards in cards mode", () => {
    const actor = startMachine()
    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "a", memberIds: ["a-0"] },
        { cardId: "b", memberIds: ["b-0"] },
        { cardId: "c", memberIds: ["c-0"] },
      ],
      selectedId: "a-0",
    })
    actor.send({ type: "FOCUS_ENTER_CHOOSER" })
    actor.send({ type: "CARD_FOCUSED", cardId: "b" })
    actor.send({ type: "CARD_KEY", cardId: "b", key: "Tab", shiftKey: false })

    const snapshot = actor.getSnapshot()
    expect(snapshot.matches("cards")).toBe(true)
    expect(snapshot.context.focusedCardId).toBe("c")
    expect(snapshot.context.focusRequest?.kind).toBe("card")
    expect(snapshot.context.focusRequest?.cardId).toBe("c")
  })

  test("drills from cards to locations and escapes back", () => {
    const actor = startMachine()
    actor.send({
      type: "SYNC_LAYOUT",
      cards: [{ cardId: "a", memberIds: ["a-0", "a-1"] }],
      selectedId: "a-1",
    })
    actor.send({ type: "FOCUS_ENTER_CHOOSER" })
    actor.send({ type: "CARD_KEY", cardId: "a", key: "Enter", shiftKey: false })

    let snapshot = actor.getSnapshot()
    expect(snapshot.matches("locations")).toBe(true)
    expect(snapshot.context.focusedMemberIndexByCard.a).toBe(1)

    actor.send({ type: "MEMBER_KEY", cardId: "a", memberIndex: 1, key: "Escape", shiftKey: false })
    snapshot = actor.getSnapshot()
    expect(snapshot.matches("cards")).toBe(true)
    expect(snapshot.context.focusRequest?.kind).toBe("card")
    expect(snapshot.context.focusRequest?.cardId).toBe("a")
  })

  test("Arrow keys move focus in locations without committing selection", () => {
    const actor = startMachine()
    actor.send({
      type: "SYNC_LAYOUT",
      cards: [{ cardId: "a", memberIds: ["a-0", "a-1", "a-2"] }],
      selectedId: "a-0",
    })
    actor.send({ type: "FOCUS_ENTER_CHOOSER" })
    actor.send({ type: "CARD_KEY", cardId: "a", key: "Enter", shiftKey: false })
    actor.send({ type: "MEMBER_KEY", cardId: "a", memberIndex: 0, key: "ArrowDown", shiftKey: false })

    const snapshot = actor.getSnapshot()
    expect(snapshot.matches("locations")).toBe(true)
    expect(snapshot.context.focusedMemberIndexByCard.a).toBe(1)
    expect(snapshot.context.selectedId).toBe("a-0")
    expect(snapshot.context.selectionRequest).toBeNull()
  })

  test("Enter/Space in locations commits explicit selection", () => {
    const actor = startMachine()
    actor.send({
      type: "SYNC_LAYOUT",
      cards: [{ cardId: "a", memberIds: ["a-0", "a-1"] }],
      selectedId: "a-0",
    })
    actor.send({ type: "FOCUS_ENTER_CHOOSER" })
    actor.send({ type: "CARD_KEY", cardId: "a", key: "Enter", shiftKey: false })
    actor.send({ type: "MEMBER_KEY", cardId: "a", memberIndex: 1, key: " ", shiftKey: false })

    const snapshot = actor.getSnapshot()
    expect(snapshot.matches("locations")).toBe(true)
    expect(snapshot.context.selectedId).toBe("a-1")
    expect(snapshot.context.selectionRequest?.memberId).toBe("a-1")
  })

  test("removal of focused card/member clamps to nearest valid targets", () => {
    const actor = startMachine()
    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "a", memberIds: ["a-0"] },
        { cardId: "b", memberIds: ["b-0", "b-1", "b-2"] },
      ],
      selectedId: "b-2",
    })
    actor.send({ type: "FOCUS_ENTER_CHOOSER" })
    actor.send({ type: "CARD_FOCUSED", cardId: "b" })
    actor.send({ type: "MEMBER_FOCUSED", cardId: "b", memberIndex: 2 })

    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "a", memberIds: ["a-0"] },
        { cardId: "c", memberIds: ["c-0"] },
      ],
      selectedId: "a-0",
    })

    let snapshot = actor.getSnapshot()
    expect(snapshot.context.focusedCardId).toBe("a")
    expect(snapshot.context.cardOrder).toEqual(["a", "c"])

    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "a", memberIds: ["a-0"] },
        { cardId: "c", memberIds: ["c-0", "c-1"] },
      ],
      selectedId: "c-0",
    })
    actor.send({ type: "MEMBER_FOCUSED", cardId: "c", memberIndex: 1 })
    actor.send({
      type: "SYNC_LAYOUT",
      cards: [
        { cardId: "a", memberIds: ["a-0"] },
        { cardId: "c", memberIds: ["c-0"] },
      ],
      selectedId: "c-0",
    })

    snapshot = actor.getSnapshot()
    expect(snapshot.context.focusedMemberIndexByCard.c).toBe(0)
  })
})

