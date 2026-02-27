import { describe, expect, test } from "bun:test"
import { createActor, waitFor } from "xstate"
import { mainlineMachine } from "./mainline.machine"
import type { MainlineAdapter, MainlinePage } from "./mainline.types"

function makeRootPage(): MainlinePage {
  return {
    id: "root",
    title: "Root",
    items: [
      { id: "page-1", label: "Go to Page", intent: "page", childPageId: "child" },
      { id: "run-1", label: "Run Action", intent: "action" },
    ],
  }
}

function makeAdapter(): MainlineAdapter {
  return {
    async loadRoot() {
      return makeRootPage()
    },
    async loadChild() {
      return {
        id: "child",
        title: "Child",
        items: [{ id: "child-action", label: "Child Action", intent: "action" }],
      }
    },
    async execute() {
      return { kind: "stay" }
    },
    async submit() {
      return { kind: "close" }
    },
  }
}

describe("mainlineMachine", () => {
  test("opens and loads root page", async () => {
    const actor = createActor(mainlineMachine, {
      input: {
        adapter: makeAdapter(),
      },
    }).start()

    actor.send({ type: "PALETTE.OPEN" })

    await waitFor(actor, (snapshot) => snapshot.matches({ open: "browsing" }))
    const snapshot = actor.getSnapshot()
    expect(snapshot.context.stack[0]?.id).toBe("root")

    actor.stop()
  })

  test("activates page commands and pushes child page", async () => {
    const actor = createActor(mainlineMachine, {
      input: {
        adapter: makeAdapter(),
      },
    }).start()

    actor.send({ type: "PALETTE.OPEN" })
    await waitFor(actor, (snapshot) => snapshot.matches({ open: "browsing" }))

    actor.send({ type: "ITEM.ACTIVATE", id: "page-1" })
    await waitFor(actor, (snapshot) => snapshot.matches({ open: "browsing" }) && snapshot.context.stack.length === 2)

    const snapshot = actor.getSnapshot()
    expect(snapshot.context.stack[1]?.id).toBe("child")

    actor.stop()
  })

  test("closes from root when backing out", async () => {
    const actor = createActor(mainlineMachine, {
      input: {
        adapter: makeAdapter(),
      },
    }).start()

    actor.send({ type: "PALETTE.OPEN" })
    await waitFor(actor, (snapshot) => snapshot.matches({ open: "browsing" }))

    actor.send({ type: "PAGE.BACK" })
    await waitFor(actor, (snapshot) => snapshot.matches("closed"))

    actor.stop()
  })
})
