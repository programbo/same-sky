import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMachine } from "@xstate/react";
import { useKeyboard } from "react-aria";
import {
  Autocomplete,
  Button,
  Dialog,
  Heading,
  Input,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  SearchField,
  Text,
} from "react-aria-components";
import { commandItem, cx, mainlineChrome } from "./mainline.variants";
import { mainlineMachine } from "./mainline.machine";
import { ensureMainlineStyles } from "./style-injection";
import type {
  MainlineCommand,
  MainlineShortcut,
  MainlinePage,
  ReactMainlineProps,
} from "./mainline.types";

function toSearchText(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function getVisibleItems(
  page: MainlinePage | null,
  query: string,
): MainlineCommand[] {
  if (!page) {
    return [];
  }

  const baseItems = page.items.filter((item) => !item.hidden);
  const normalized = toSearchText(query);
  if (!normalized) {
    return baseItems;
  }

  return baseItems.filter((item) => {
    const fields = [item.label, item.subtitle, ...(item.keywords ?? [])];
    return fields.some((field) => toSearchText(field).includes(normalized));
  });
}

function normalizeShortcutKey(key: string): string {
  return key.toLocaleLowerCase();
}

function hasMatchingShortcut(
  shortcuts: MainlineShortcut[] | undefined,
  key: string,
  activeItemId: string | null,
): boolean {
  if (!shortcuts || shortcuts.length === 0) {
    return false;
  }

  const normalizedKey = normalizeShortcutKey(key);
  return shortcuts.some((shortcut) => {
    if (normalizeShortcutKey(shortcut.key) !== normalizedKey) {
      return false;
    }

    if (!shortcut.targetItemId) {
      return true;
    }

    return shortcut.targetItemId === activeItemId;
  });
}

function getShortcutCommandId(
  page: MainlinePage | null,
  key: string,
  activeItemId: string | null,
): string | null {
  if (!page) {
    return null;
  }

  const command =
    page.items.find(
      (item) =>
        !item.disabled &&
        hasMatchingShortcut(item.shortcuts, key, activeItemId),
    ) ?? null;
  return command?.id ?? null;
}

export function ReactMainline({
  adapter,
  classNames,
  triggerLabel = "COMMAND",
  hotkeys = true,
}: ReactMainlineProps): React.JSX.Element {
  const [state, send] = useMachine(mainlineMachine, {
    input: {
      adapter,
    },
  });

  const slots = mainlineChrome();
  const isOpen = !state.matches("closed");
  const stack = state.context.stack;
  const currentPage =
    stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
  const query = state.context.query;
  const visibleItems = useMemo(
    () => getVisibleItems(currentPage, query),
    [currentPage, query],
  );
  const activeItemId =
    state.context.activeItemId ?? visibleItems[0]?.id ?? null;
  const activeCommand = activeItemId
    ? (visibleItems.find((item) => item.id === activeItemId) ?? null)
    : null;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousStateValueRef = useRef<string | null>(null);
  const dispatch = useCallback(
    (event: Parameters<typeof send>[0]) => {
      console.debug("[react-mainline:event]", event);
      send(event);
    },
    [send],
  );

  useEffect(() => {
    ensureMainlineStyles();
  }, []);

  useEffect(() => {
    const nextValue = JSON.stringify(state.value);
    const previousValue = previousStateValueRef.current;

    console.debug("[react-mainline:transition]", {
      from: previousValue ? JSON.parse(previousValue) : null,
      to: state.value,
      pageId: currentPage?.id ?? null,
      query,
      activeItemId,
      activeItemLabel: activeCommand?.label ?? null,
      activeItemDisabled: activeCommand?.disabled ?? false,
      visibleItemCount: visibleItems.length,
      lastError: state.context.lastError,
    });

    previousStateValueRef.current = nextValue;
  }, [
    activeCommand?.disabled,
    activeCommand?.label,
    activeItemId,
    currentPage?.id,
    query,
    state.context.lastError,
    state.value,
    visibleItems.length,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!hotkeys) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLocaleLowerCase();
      const isPaletteKey = key === "k" && (event.metaKey || event.ctrlKey);
      if (!isPaletteKey) {
        return;
      }

      event.preventDefault();
      dispatch({ type: "PALETTE.TOGGLE" });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dispatch, hotkeys]);

  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "PAGE.BACK" });
        return;
      }

      if (!currentPage) {
        event.continuePropagation();
        return;
      }

      if (
        (currentPage.mode ?? "list") === "list" &&
        query.trim().length === 0
      ) {
        const shortcutCommandId = getShortcutCommandId(
          currentPage,
          event.key,
          activeItemId,
        );
        if (shortcutCommandId) {
          event.preventDefault();
          dispatch({ type: "ITEM.ACTIVATE", id: shortcutCommandId });
          return;
        }
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        dispatch({ type: "NAV.NEXT" });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        dispatch({ type: "NAV.PREV" });
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        dispatch({ type: "NAV.HOME" });
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        dispatch({ type: "NAV.END" });
        return;
      }

      if (event.key !== "Enter") {
        event.continuePropagation();
        return;
      }

      event.preventDefault();
      if ((currentPage.mode ?? "list") === "input") {
        dispatch({ type: "INPUT.SUBMIT", value: query });
        return;
      }

      dispatch({ type: "ITEM.ACTIVATE", id: activeItemId ?? undefined });
    },
  });

  return (
    <>
      <Button
        type="button"
        className={cx(slots.trigger(), classNames?.trigger)}
        onPress={() => {
          dispatch({ type: "PALETTE.TOGGLE" });
        }}
      >
        <span>{triggerLabel}</span>
        <span aria-hidden="true">⌘K</span>
      </Button>

      <ModalOverlay
        isOpen={isOpen}
        isDismissable
        onOpenChange={(nextIsOpen) => {
          dispatch({ type: nextIsOpen ? "PALETTE.OPEN" : "PALETTE.CLOSE" });
        }}
        className={cx(slots.overlay(), classNames?.overlay)}
      >
        <Modal
          className={cx(
            slots.modal(),
            "react-mainline-panel-enter",
            classNames?.modal,
          )}
        >
          <Dialog
            aria-label={currentPage?.title ?? "Command palette"}
            className={cx(slots.dialog(), classNames?.dialog)}
          >
            <div className="contents">
              <header className={cx(slots.header(), classNames?.header)}>
                <Heading
                  slot="title"
                  className={cx(slots.title(), classNames?.title)}
                >
                  {currentPage?.title ?? "Command palette"}
                </Heading>
                {currentPage?.subtitle ? (
                  <p className={cx(slots.subtitle(), classNames?.subtitle)}>
                    {currentPage.subtitle}
                  </p>
                ) : null}

                <Autocomplete
                  inputValue={query}
                  onInputChange={(value) =>
                    dispatch({ type: "QUERY.CHANGED", query: value })
                  }
                >
                  <SearchField
                    aria-label={currentPage?.placeholder ?? "Search commands"}
                    value={query}
                    onChange={(value) =>
                      dispatch({ type: "QUERY.CHANGED", query: value })
                    }
                    className={cx(slots.searchField(), classNames?.searchField)}
                  >
                    <Input
                      autoFocus
                      ref={inputRef}
                      {...keyboardProps}
                      className={cx(slots.input(), classNames?.input)}
                      placeholder={currentPage?.placeholder ?? "Search"}
                    />
                    {(currentPage?.mode ?? "list") === "input" ? (
                      <Button
                        type="button"
                        className={cx(
                          slots.inputSubmit(),
                          classNames?.inputSubmit,
                        )}
                        onPress={() => {
                          dispatch({ type: "INPUT.SUBMIT", value: query });
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
                      selectionMode="single"
                      selectedKeys={
                        activeItemId ? new Set([activeItemId]) : new Set()
                      }
                      onAction={(key) => {
                        dispatch({ type: "ITEM.ACTIVATE", id: String(key) });
                      }}
                      renderEmptyState={() => (
                        <div
                          className={cx(
                            slots.emptyState(),
                            classNames?.emptyState,
                          )}
                        >
                          {currentPage?.emptyStateText ?? "No commands found."}
                        </div>
                      )}
                    >
                      {(item) => {
                        return (
                          <ListBoxItem
                            id={item.id}
                            textValue={item.label}
                            className={cx(
                              commandItem({ disabled: item.disabled }),
                              classNames?.item,
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <Text
                                slot="label"
                                className={cx(
                                  "block truncate text-[0.9rem] font-medium text-[#f4fbff]",
                                  classNames?.itemLabel,
                                )}
                              >
                                {item.label}
                              </Text>
                              {item.subtitle ? (
                                <Text
                                  slot="description"
                                  className={cx(
                                    "mt-0.5 block truncate text-[0.76rem] text-[#a4bfd2]",
                                    classNames?.itemSubtitle,
                                  )}
                                >
                                  {item.subtitle}
                                </Text>
                              ) : null}
                            </div>
                          </ListBoxItem>
                        );
                      }}
                    </ListBox>
                  ) : null}
                </Autocomplete>
              </header>

              <footer
                className={cx(slots.footerHint(), classNames?.footerHint)}
              >
                ↑↓ navigate · Enter select · Esc back/close · Cmd/Ctrl+K toggle
              </footer>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}

export default ReactMainline;
