import { assign, fromPromise, setup } from "xstate";
import type {
  MainlineAdapter,
  MainlineCommand,
  MainlineMeta,
  MainlinePage,
  MainlineResult,
} from "./mainline.types";

interface MainlineLoadRequest {
  kind: "root" | "child" | "refresh";
  pageId?: string;
  itemId?: string;
  meta?: MainlineMeta;
}

interface MainlineContext {
  adapter: MainlineAdapter;
  stack: MainlinePage[];
  query: string;
  activeItemId: string | null;
  lastError: string | null;
  pendingLoad: MainlineLoadRequest | null;
  pendingCommand: MainlineCommand | null;
  invocationMeta: MainlineMeta;
  inputValue: string;
}

interface MainlineInput {
  adapter: MainlineAdapter;
}

type MainlineEvent =
  | { type: "PALETTE.OPEN" }
  | { type: "PALETTE.CLOSE" }
  | { type: "PALETTE.TOGGLE" }
  | { type: "QUERY.CHANGED"; query: string }
  | { type: "NAV.NEXT" }
  | { type: "NAV.PREV" }
  | { type: "NAV.HOME" }
  | { type: "NAV.END" }
  | { type: "ITEM.ACTIVATE"; id?: string }
  | { type: "PAGE.BACK" }
  | { type: "INPUT.SUBMIT"; value?: string }
  | { type: "RETRY" };

function currentPage(stack: MainlinePage[]): MainlinePage | null {
  return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
}

function toSearchText(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function filterCommands(
  page: MainlinePage | null,
  query: string,
): MainlineCommand[] {
  if (!page) {
    return [];
  }

  const visibleItems = page.items.filter((item) => !item.hidden);
  const normalized = toSearchText(query);
  if (!normalized) {
    return visibleItems;
  }

  return visibleItems.filter((item) => {
    const fields = [item.label, item.subtitle, ...(item.keywords ?? [])];
    return fields.some((field) => toSearchText(field).includes(normalized));
  });
}

function firstActiveItemId(
  page: MainlinePage | null,
  query: string,
): string | null {
  return filterCommands(page, query)[0]?.id ?? null;
}

function findCommand(
  page: MainlinePage | null,
  query: string,
  commandId?: string,
): MainlineCommand | null {
  if (!page) {
    return null;
  }

  if (commandId) {
    return page.items.find((item) => item.id === commandId) ?? null;
  }

  const commands = filterCommands(page, query);
  if (commands.length === 0) {
    return null;
  }

  return commands[0] ?? null;
}

function moveActiveId(
  context: MainlineContext,
  direction: "next" | "prev" | "home" | "end",
): string | null {
  const page = currentPage(context.stack);
  const commands = filterCommands(page, context.query);
  if (commands.length === 0) {
    return null;
  }

  if (direction === "home") {
    return commands[0]?.id ?? null;
  }

  if (direction === "end") {
    return commands[commands.length - 1]?.id ?? null;
  }

  const currentId = context.activeItemId;
  const currentIndex = commands.findIndex((item) => item.id === currentId);
  const fallback = direction === "next" ? 0 : commands.length - 1;
  const baseIndex = currentIndex < 0 ? fallback : currentIndex;
  const nextIndex =
    direction === "next"
      ? (baseIndex + 1) % commands.length
      : (baseIndex - 1 + commands.length) % commands.length;
  return commands[nextIndex]?.id ?? null;
}

function applyLoadedPage(
  context: MainlineContext,
  page: MainlinePage,
): MainlineContext {
  const mode = context.pendingLoad?.kind ?? "root";
  const nextStack =
    mode === "root"
      ? [page]
      : mode === "refresh"
        ? [...context.stack.slice(0, -1), page]
        : [...context.stack, page];

  return {
    ...context,
    stack: nextStack,
    query: "",
    activeItemId: firstActiveItemId(page, ""),
    pendingLoad: null,
    pendingCommand: null,
    invocationMeta: page.meta,
    lastError: null,
  };
}

function applyResult(
  context: MainlineContext,
  result: MainlineResult,
): MainlineContext {
  if (result.kind === "pushPage") {
    const nextStack = [...context.stack, result.page];
    return {
      ...context,
      stack: nextStack,
      query: "",
      activeItemId: firstActiveItemId(result.page, ""),
      pendingCommand: null,
      invocationMeta: result.page.meta,
      lastError: null,
    };
  }

  if (result.kind === "replacePage") {
    const fallbackBase =
      context.stack.length > 0 ? context.stack.slice(0, -1) : [];
    const nextStack = [...fallbackBase, result.page];
    return {
      ...context,
      stack: nextStack,
      query: "",
      activeItemId: firstActiveItemId(result.page, ""),
      pendingCommand: null,
      invocationMeta: result.page.meta,
      lastError: null,
    };
  }

  if (result.kind === "popPage") {
    const nextStack =
      context.stack.length > 1 ? context.stack.slice(0, -1) : context.stack;
    const page = currentPage(nextStack);
    return {
      ...context,
      stack: nextStack,
      query: "",
      activeItemId: firstActiveItemId(page, ""),
      pendingCommand: null,
      invocationMeta: page?.meta,
      lastError: null,
    };
  }

  return {
    ...context,
    pendingCommand: null,
    lastError: null,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

export const mainlineMachine = setup({
  types: {
    context: {} as MainlineContext,
    events: {} as MainlineEvent,
    input: {} as MainlineInput,
  },
  guards: {
    hasParentPage: ({ context }) => context.stack.length > 1,
    hasPendingLoad: ({ context }) => context.pendingLoad !== null,
    pageIsInput: ({ context }) =>
      (currentPage(context.stack)?.mode ?? "list") === "input",
    selectedCommandIsPage: ({ context }) =>
      Boolean(
        context.pendingCommand &&
        !context.pendingCommand.disabled &&
        context.pendingCommand.intent === "page",
      ),
    selectedCommandIsAction: ({ context }) =>
      Boolean(
        context.pendingCommand &&
        !context.pendingCommand.disabled &&
        context.pendingCommand.intent === "action",
      ),
    activatedCommandIsPage: ({ context }, params: { commandId?: string }) => {
      const command = findCommand(
        currentPage(context.stack),
        context.query,
        params.commandId ?? context.activeItemId ?? undefined,
      );
      return Boolean(command && !command.disabled && command.intent === "page");
    },
    activatedCommandIsAction: ({ context }, params: { commandId?: string }) => {
      const command = findCommand(
        currentPage(context.stack),
        context.query,
        params.commandId ?? context.activeItemId ?? undefined,
      );
      return Boolean(
        command && !command.disabled && command.intent === "action",
      );
    },
    resultIsClose: (_, params: { result: MainlineResult }) =>
      params.result.kind === "close",
    resultIsRefresh: (_, params: { result: MainlineResult }) =>
      params.result.kind === "refreshPage",
    resultIsError: (_, params: { result: MainlineResult }) =>
      params.result.kind === "error",
    resultIsPush: (_, params: { result: MainlineResult }) =>
      params.result.kind === "pushPage",
    resultIsReplace: (_, params: { result: MainlineResult }) =>
      params.result.kind === "replacePage",
    resultIsPop: (_, params: { result: MainlineResult }) =>
      params.result.kind === "popPage",
  },
  actions: {
    notifyOpened: ({ context }) => {
      context.adapter.onOpenChange?.(true);
    },
    notifyClosed: ({ context }) => {
      context.adapter.onOpenChange?.(false);
    },
    prepareRootLoad: assign({
      query: () => "",
      inputValue: () => "",
      pendingLoad: () => ({ kind: "root" as const }),
      pendingCommand: () => null,
      lastError: () => null,
      invocationMeta: () => null,
    }),
    storeLoadedPage: assign({
      stack: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).stack,
      query: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).query,
      activeItemId: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).activeItemId,
      pendingLoad: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).pendingLoad,
      pendingCommand: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).pendingCommand,
      invocationMeta: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).invocationMeta,
      lastError: ({ context }, params: { page: MainlinePage }) =>
        applyLoadedPage(context, params.page).lastError,
    }),
    setLastError: assign({
      lastError: (_, params: { error: unknown }) =>
        toErrorMessage(params.error),
    }),
    setQuery: assign({
      query: (_, params: { query: string }) => params.query,
      activeItemId: ({ context }, params: { query: string }) =>
        firstActiveItemId(currentPage(context.stack), params.query),
    }),
    moveNext: assign({
      activeItemId: ({ context }) => moveActiveId(context, "next"),
    }),
    movePrev: assign({
      activeItemId: ({ context }) => moveActiveId(context, "prev"),
    }),
    moveHome: assign({
      activeItemId: ({ context }) => moveActiveId(context, "home"),
    }),
    moveEnd: assign({
      activeItemId: ({ context }) => moveActiveId(context, "end"),
    }),
    pickCommand: assign({
      pendingCommand: ({ context }, params: { commandId?: string }) =>
        findCommand(
          currentPage(context.stack),
          context.query,
          params.commandId ?? context.activeItemId ?? undefined,
        ),
      invocationMeta: ({ context }, params: { commandId?: string }) => {
        const found = findCommand(
          currentPage(context.stack),
          context.query,
          params.commandId ?? context.activeItemId ?? undefined,
        );
        return found?.meta;
      },
    }),
    prepareChildLoad: assign({
      pendingLoad: ({ context }) => {
        const page = currentPage(context.stack);
        const command = context.pendingCommand;
        if (
          !page ||
          !command ||
          command.intent !== "page" ||
          !command.childPageId
        ) {
          return null;
        }

        return {
          kind: "child" as const,
          pageId: command.childPageId,
          itemId: command.id,
          meta: command.meta,
        };
      },
      inputValue: () => "",
    }),
    prepareInputSubmit: assign({
      inputValue: ({ context }, params: { value?: string }) =>
        params.value ?? context.query,
      invocationMeta: ({ context }) => currentPage(context.stack)?.meta,
    }),
    prepareRefreshLoad: assign({
      pendingLoad: () => ({ kind: "root" as const }),
      pendingCommand: () => null,
    }),
    applyResult: assign({
      stack: ({ context }, params: { result: MainlineResult }) =>
        applyResult(context, params.result).stack,
      query: ({ context }, params: { result: MainlineResult }) =>
        applyResult(context, params.result).query,
      activeItemId: ({ context }, params: { result: MainlineResult }) =>
        applyResult(context, params.result).activeItemId,
      pendingCommand: ({ context }, params: { result: MainlineResult }) =>
        applyResult(context, params.result).pendingCommand,
      invocationMeta: ({ context }, params: { result: MainlineResult }) =>
        applyResult(context, params.result).invocationMeta,
      lastError: ({ context }, params: { result: MainlineResult }) =>
        applyResult(context, params.result).lastError,
    }),
    applyResultError: assign({
      lastError: (_, params: { result: MainlineResult }) =>
        params.result.kind === "error"
          ? params.result.message
          : "Unexpected mainline command error.",
      pendingCommand: () => null,
    }),
    popPage: assign({
      stack: ({ context }) => {
        return context.stack.length > 1
          ? context.stack.slice(0, -1)
          : context.stack;
      },
      query: () => "",
      activeItemId: ({ context }) => {
        const nextStack =
          context.stack.length > 1 ? context.stack.slice(0, -1) : context.stack;
        return firstActiveItemId(currentPage(nextStack), "");
      },
      pendingCommand: () => null,
      invocationMeta: ({ context }) => {
        const nextStack =
          context.stack.length > 1 ? context.stack.slice(0, -1) : context.stack;
        return currentPage(nextStack)?.meta;
      },
    }),
    clearError: assign({
      lastError: () => null,
    }),
  },
  actors: {
    loadPage: fromPromise(
      async ({
        input,
      }: {
        input: {
          adapter: MainlineAdapter;
          request: MainlineLoadRequest;
          query: string;
        };
      }) => {
        const request = input.request;
        if (request.kind === "root") {
          return input.adapter.loadRoot();
        }

        if (!request.pageId || !request.itemId) {
          throw new Error("Missing child page request details.");
        }

        const result = await input.adapter.loadChild(
          request.pageId,
          request.itemId,
          input.query,
          request.meta,
        );
        if ("kind" in result) {
          throw new Error(
            "Expected a page from loadChild but received a command result.",
          );
        }

        return result;
      },
    ),
    executeItem: fromPromise(
      async ({
        input,
      }: {
        input: {
          adapter: MainlineAdapter;
          pageId: string;
          itemId: string;
          query: string;
          meta?: MainlineMeta;
        };
      }) => {
        return input.adapter.execute(
          input.itemId,
          input.pageId,
          input.query,
          input.meta,
        );
      },
    ),
    submitInput: fromPromise(
      async ({
        input,
      }: {
        input: {
          adapter: MainlineAdapter;
          pageId: string;
          value: string;
          meta?: MainlineMeta;
        };
      }) => {
        return input.adapter.submit(input.pageId, input.value, input.meta);
      },
    ),
  },
}).createMachine({
  id: "mainline",
  context: ({ input }) => ({
    adapter: input.adapter,
    stack: [],
    query: "",
    activeItemId: null,
    lastError: null,
    pendingLoad: null,
    pendingCommand: null,
    invocationMeta: null,
    inputValue: "",
  }),
  initial: "closed",
  states: {
    closed: {
      on: {
        "PALETTE.OPEN": {
          target: "open.loadingPage",
          actions: ["prepareRootLoad", "notifyOpened"],
        },
        "PALETTE.TOGGLE": {
          target: "open.loadingPage",
          actions: ["prepareRootLoad", "notifyOpened"],
        },
      },
    },
    open: {
      on: {
        "PALETTE.CLOSE": {
          target: "closed",
          actions: "notifyClosed",
        },
        "PALETTE.TOGGLE": {
          target: "closed",
          actions: "notifyClosed",
        },
      },
      initial: "loadingPage",
      states: {
        loadingPage: {
          invoke: {
            src: "loadPage",
            input: ({ context }) => ({
              adapter: context.adapter,
              request: context.pendingLoad ?? { kind: "root" as const },
              query: context.query,
            }),
            onDone: {
              target: "browsing",
              actions: {
                type: "storeLoadedPage",
                params: ({ event }) => ({ page: event.output }),
              },
            },
            onError: {
              target: "error",
              actions: {
                type: "setLastError",
                params: ({ event }) => ({ error: event.error }),
              },
            },
          },
        },
        browsing: {
          on: {
            "QUERY.CHANGED": {
              actions: {
                type: "setQuery",
                params: ({ event }) => ({ query: event.query }),
              },
            },
            "NAV.NEXT": { actions: "moveNext" },
            "NAV.PREV": { actions: "movePrev" },
            "NAV.HOME": { actions: "moveHome" },
            "NAV.END": { actions: "moveEnd" },
            "ITEM.ACTIVATE": [
              {
                guard: {
                  type: "activatedCommandIsPage",
                  params: ({ event }) => ({ commandId: event.id }),
                },
                target: "loadingPage",
                actions: [
                  {
                    type: "pickCommand",
                    params: ({ event }) => ({ commandId: event.id }),
                  },
                  "prepareChildLoad",
                ],
              },
              {
                guard: {
                  type: "activatedCommandIsAction",
                  params: ({ event }) => ({ commandId: event.id }),
                },
                target: "executing",
                actions: {
                  type: "pickCommand",
                  params: ({ event }) => ({ commandId: event.id }),
                },
              },
            ],
            "INPUT.SUBMIT": {
              guard: "pageIsInput",
              target: "submittingInput",
              actions: {
                type: "prepareInputSubmit",
                params: ({ event }) => ({ value: event.value }),
              },
            },
            "PAGE.BACK": [
              {
                guard: "hasParentPage",
                actions: "popPage",
              },
              {
                target: "#mainline.closed",
                actions: "notifyClosed",
              },
            ],
          },
        },
        executing: {
          invoke: {
            src: "executeItem",
            input: ({ context }) => {
              const page = currentPage(context.stack);
              const command = context.pendingCommand;
              if (!page || !command) {
                throw new Error("No command selected for execution.");
              }

              return {
                adapter: context.adapter,
                pageId: page.id,
                itemId: command.id,
                query: context.query,
                meta: command.meta,
              };
            },
            onDone: [
              {
                guard: {
                  type: "resultIsClose",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "#mainline.closed",
                actions: "notifyClosed",
              },
              {
                guard: {
                  type: "resultIsRefresh",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "loadingPage",
                actions: "prepareRefreshLoad",
              },
              {
                guard: {
                  type: "resultIsError",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "error",
                actions: {
                  type: "applyResultError",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
              {
                guard: {
                  type: "resultIsPush",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "browsing",
                actions: {
                  type: "applyResult",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
              {
                guard: {
                  type: "resultIsReplace",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "browsing",
                actions: {
                  type: "applyResult",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
              {
                guard: {
                  type: "resultIsPop",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "browsing",
                actions: {
                  type: "applyResult",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
              {
                target: "browsing",
                actions: {
                  type: "applyResult",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
            ],
            onError: {
              target: "error",
              actions: {
                type: "setLastError",
                params: ({ event }) => ({ error: event.error }),
              },
            },
          },
        },
        submittingInput: {
          invoke: {
            src: "submitInput",
            input: ({ context }) => {
              const page = currentPage(context.stack);
              if (!page) {
                throw new Error("No page available for input submission.");
              }

              return {
                adapter: context.adapter,
                pageId: page.id,
                value: context.inputValue,
                meta: context.invocationMeta,
              };
            },
            onDone: [
              {
                guard: {
                  type: "resultIsClose",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "#mainline.closed",
                actions: "notifyClosed",
              },
              {
                guard: {
                  type: "resultIsRefresh",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "loadingPage",
                actions: "prepareRefreshLoad",
              },
              {
                guard: {
                  type: "resultIsError",
                  params: ({ event }) => ({ result: event.output }),
                },
                target: "error",
                actions: {
                  type: "applyResultError",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
              {
                target: "browsing",
                actions: {
                  type: "applyResult",
                  params: ({ event }) => ({ result: event.output }),
                },
              },
            ],
            onError: {
              target: "error",
              actions: {
                type: "setLastError",
                params: ({ event }) => ({ error: event.error }),
              },
            },
          },
        },
        error: {
          on: {
            RETRY: [
              {
                guard: "hasPendingLoad",
                target: "loadingPage",
                actions: "clearError",
              },
              {
                target: "browsing",
                actions: "clearError",
              },
            ],
            "PAGE.BACK": [
              {
                guard: "hasParentPage",
                target: "browsing",
                actions: ["clearError", "popPage"],
              },
              {
                target: "#mainline.closed",
                actions: "notifyClosed",
              },
            ],
            "QUERY.CHANGED": {
              target: "browsing",
              actions: {
                type: "setQuery",
                params: ({ event }) => ({ query: event.query }),
              },
            },
          },
        },
      },
    },
  },
});
