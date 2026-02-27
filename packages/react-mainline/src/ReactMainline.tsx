import type React from "react"
import { useEffect, useMemo } from "react"
import { useMachine } from "@xstate/react"
import {
  Autocomplete,
  Button,
  Dialog,
  Input,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  SearchField,
  Text,
} from "react-aria-components"
import { commandItem, cx, mainlineChrome } from "./mainline.variants"
import { mainlineMachine } from "./mainline.machine"
import { ensureMainlineStyles } from "./style-injection"
import type { MainlineCommand, MainlinePage, ReactMainlineProps } from "./mainline.types"

function toSearchText(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? ""
}

function getVisibleItems(page: MainlinePage | null, query: string): MainlineCommand[] {
  if (!page) {
    return []
  }

  const normalized = toSearchText(query)
  if (!normalized) {
    return page.items
  }

  return page.items.filter((item) => {
    const fields = [item.label, item.subtitle, ...(item.keywords ?? [])]
    return fields.some((field) => toSearchText(field).includes(normalized))
  })
}

export function ReactMainline({
  adapter,
  classNames,
  triggerLabel = "Command",
  hotkeys = true,
}: ReactMainlineProps): React.JSX.Element {
  const [state, send] = useMachine(mainlineMachine, {
    input: {
      adapter,
    },
  })

  const slots = mainlineChrome()
  const isOpen = !state.matches("closed")
  const stack = state.context.stack
  const currentPage = stack.length > 0 ? stack[stack.length - 1] ?? null : null
  const query = state.context.query
  const visibleItems = useMemo(() => getVisibleItems(currentPage, query), [currentPage, query])
  const activeItemId = state.context.activeItemId ?? visibleItems[0]?.id ?? null

  useEffect(() => {
    ensureMainlineStyles()
  }, [])

  useEffect(() => {
    if (!hotkeys) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLocaleLowerCase()
      const isPaletteKey = key === "k" && (event.metaKey || event.ctrlKey)
      if (!isPaletteKey) {
        return
      }

      event.preventDefault()
      send({ type: "PALETTE.TOGGLE" })
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [hotkeys, send])

  const onDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      send({ type: "PAGE.BACK" })
      return
    }

    if (!currentPage) {
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      send({ type: "NAV.NEXT" })
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      send({ type: "NAV.PREV" })
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      send({ type: "NAV.HOME" })
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      send({ type: "NAV.END" })
      return
    }

    if (event.key !== "Enter") {
      return
    }

    event.preventDefault()
    if ((currentPage.mode ?? "list") === "input") {
      send({ type: "INPUT.SUBMIT", value: query })
      return
    }

    send({ type: "ITEM.ACTIVATE", id: activeItemId ?? undefined })
  }

  return (
    <>
      <Button
        type="button"
        className={cx(slots.trigger(), classNames?.trigger)}
        onPress={() => {
          send({ type: "PALETTE.TOGGLE" })
        }}
      >
        <span>{triggerLabel}</span>
        <span aria-hidden="true">⌘K</span>
      </Button>

      <ModalOverlay
        isOpen={isOpen}
        isDismissable
        onOpenChange={(nextIsOpen) => {
          send({ type: nextIsOpen ? "PALETTE.OPEN" : "PALETTE.CLOSE" })
        }}
        className={cx(slots.overlay(), classNames?.overlay)}
      >
        <Modal className={cx(slots.modal(), "react-mainline-panel-enter", classNames?.modal)}>
          <Dialog className={cx(slots.dialog(), classNames?.dialog)}>
            <div className="contents" onKeyDown={onDialogKeyDown}>
            <header className={cx(slots.header(), classNames?.header)}>
              <h2 className={cx(slots.title(), classNames?.title)}>{currentPage?.title ?? "Command palette"}</h2>
              {currentPage?.subtitle ? <p className={cx(slots.subtitle(), classNames?.subtitle)}>{currentPage.subtitle}</p> : null}

              <Autocomplete inputValue={query} onInputChange={(value) => send({ type: "QUERY.CHANGED", query: value })}>
                <SearchField
                  aria-label={currentPage?.placeholder ?? "Search commands"}
                  value={query}
                  onChange={(value) => send({ type: "QUERY.CHANGED", query: value })}
                  className={cx(slots.searchField(), classNames?.searchField)}
                >
                  <Input className={cx(slots.input(), classNames?.input)} placeholder={currentPage?.placeholder ?? "Search"} />
                  {(currentPage?.mode ?? "list") === "input" ? (
                    <Button
                      type="button"
                      className={cx(slots.inputSubmit(), classNames?.inputSubmit)}
                      onPress={() => {
                        send({ type: "INPUT.SUBMIT", value: query })
                      }}
                    >
                      {currentPage?.submitLabel ?? "Submit"}
                    </Button>
                  ) : null}
                </SearchField>

                {(currentPage?.mode ?? "list") === "list" ? (
                  <ListBox
                    aria-label={currentPage?.title ?? "Command list"}
                    className={cx(slots.list(), classNames?.list)}
                    items={visibleItems}
                    selectedKeys={activeItemId ? [activeItemId] : []}
                    onAction={(key) => {
                      send({ type: "ITEM.ACTIVATE", id: String(key) })
                    }}
                    renderEmptyState={() => (
                      <div className={cx(slots.emptyState(), classNames?.emptyState)}>
                        {currentPage?.emptyStateText ?? "No commands found."}
                      </div>
                    )}
                  >
                    {(item) => {
                      const isActive = activeItemId === item.id
                      return (
                        <ListBoxItem
                          id={item.id}
                          textValue={item.label}
                          className={cx(commandItem({ active: isActive, disabled: item.disabled }), classNames?.item)}
                        >
                          <div className="min-w-0 flex-1">
                            <Text
                              slot="label"
                              className={cx("block truncate text-[0.9rem] font-medium text-[#f4fbff]", classNames?.itemLabel)}
                            >
                              {item.label}
                            </Text>
                            {item.subtitle ? (
                              <Text
                                slot="description"
                                className={cx("mt-0.5 block truncate text-[0.76rem] text-[#a4bfd2]", classNames?.itemSubtitle)}
                              >
                                {item.subtitle}
                              </Text>
                            ) : null}
                          </div>
                        </ListBoxItem>
                      )
                    }}
                  </ListBox>
                ) : null}
              </Autocomplete>
            </header>

            <footer className={cx(slots.footerHint(), classNames?.footerHint)}>
              ↑↓ navigate · Enter select · Esc back/close · Cmd/Ctrl+K toggle
            </footer>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  )
}

export default ReactMainline
