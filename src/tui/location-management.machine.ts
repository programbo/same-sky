import { assign, fromPromise, setup } from "xstate";
import type {
  PersistedLocation,
  PersistedLocationStoreLike,
  TimeInPlaceService,
} from "../lib/time-in-place";
import type { LocationMatch } from "../lib/time-in-place";
import type { LocationActionChoice, TuiUi } from "./ui-contract";

interface RemovalOutcome {
  removedCount: number;
  missingCount: number;
}

interface LocationMachineContext {
  service: Pick<TimeInPlaceService, "lookupLocations">;
  store: PersistedLocationStoreLike;
  ui: TuiUi;
  query: string;
  lookupResults: LocationMatch[];
  selectedResult: LocationMatch | null;
  nickname: string;
  persistedLocations: PersistedLocation[];
  selectedRemovalIds: string[];
  removalOutcome: RemovalOutcome;
  fatalError: string | null;
}

interface LocationMachineInput {
  service: Pick<TimeInPlaceService, "lookupLocations">;
  store: PersistedLocationStoreLike;
  ui: TuiUi;
}

type LocationMachineEvent = { type: "LOCATION.NOOP" };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function formatLocation(match: LocationMatch): string {
  return `${match.name} (${match.coords.lat.toFixed(4)}, ${match.coords.long.toFixed(4)})`;
}

function formatPersisted(location: PersistedLocation): string {
  const nicknamePart = location.nickname ? ` | ${location.nickname}` : "";
  return `${location.name}${nicknamePart} [${location.id}]`;
}

export const locationManagementMachine = setup({
  types: {
    context: {} as LocationMachineContext,
    events: {} as LocationMachineEvent,
    input: {} as LocationMachineInput,
    output: {} as { status: "completed" } | { status: "failed"; error: string },
  },
  guards: {
    menuChoiceLookup: (_, params: { choice: LocationActionChoice }) => params.choice === "lookup",
    menuChoiceView: (_, params: { choice: LocationActionChoice }) => params.choice === "view",
    menuChoiceRemove: (_, params: { choice: LocationActionChoice }) => params.choice === "remove",
    menuChoiceBack: (_, params: { choice: LocationActionChoice }) => params.choice === "back",
    emptyLookupQuery: (_, params: { query: string }) => params.query.trim().length === 0,
    noLookupResults: (_, params: { count: number }) => params.count === 0,
    singleLookupResult: ({ context }) => context.lookupResults.length === 1,
    resultSelectionCancelled: (_, params: { index: number | null }) => params.index === null,
    nicknameCancelled: (_, params: { nickname: string | null }) => params.nickname === null,
    noPersistedForRemoval: (_, params: { count: number }) => params.count === 0,
    noRemovalSelection: (_, params: { selectedIds: string[] }) => params.selectedIds.length === 0,
  },
  actions: {
    printLocationExit: ({ context }) => {
      context.ui.printInfo("Leaving location persistence.");
    },
    storeLookupQuery: assign({
      query: (_, params: { query: string }) => params.query.trim(),
      selectedResult: () => null,
      nickname: () => "",
    }),
    printEmptyLookupQuery: ({ context }) => {
      context.ui.printWarning("Search query cannot be empty.");
    },
    storeLookupResults: assign({
      lookupResults: (_, params: { results: LocationMatch[] }) => params.results,
      selectedResult: () => null,
    }),
    printNoLookupResults: ({ context }) => {
      context.ui.printWarning(`No locations found for \"${context.query}\".`);
    },
    autoSelectOnlyResult: assign({
      selectedResult: ({ context }) => context.lookupResults[0] ?? null,
    }),
    printAutoSelection: ({ context }) => {
      const selected = context.lookupResults[0];
      if (selected) {
        context.ui.printInfo(`One result found. Auto-selected ${formatLocation(selected)}.`);
      }
    },
    storeSelectedResultFromPrompt: assign({
      selectedResult: ({ context }, params: { index: number }) => context.lookupResults[params.index] ?? null,
    }),
    printLookupSelectionCancelled: ({ context }) => {
      context.ui.printInfo("Lookup selection cancelled.");
    },
    storeNickname: assign({
      nickname: ({ context }, params: { nickname: string | null }) => {
        const raw = params.nickname?.trim() ?? "";
        return raw.length > 0 ? raw : context.query;
      },
    }),
    printNicknameCancelled: ({ context }) => {
      context.ui.printInfo("Nickname prompt cancelled.");
    },
    storePersistedLocations: assign({
      persistedLocations: (_, params: { locations: PersistedLocation[] }) => params.locations,
    }),
    printPersistedLocations: ({ context }) => {
      if (context.persistedLocations.length === 0) {
        context.ui.printInfo("No persisted locations yet.");
        return;
      }

      context.ui.printHeader("Persisted locations");
      for (const location of context.persistedLocations) {
        context.ui.printInfo(`- ${formatPersisted(location)}`);
      }
    },
    storePersistOutcome: assign({
      persistedLocations: ({ context }, params: { persisted: PersistedLocation }) => [params.persisted, ...context.persistedLocations],
    }),
    printPersistSuccess: ({ context }, params: { persisted: PersistedLocation }) => {
      context.ui.printSuccess(`Saved: ${formatPersisted(params.persisted)}`);
      if (context.query.trim().length > 0) {
        context.ui.printInfo(`Nickname default source query: \"${context.query}\"`);
      }
    },
    printNoPersistedToRemove: ({ context }) => {
      context.ui.printInfo("No persisted locations to remove.");
    },
    storeSelectedRemovalIds: assign({
      selectedRemovalIds: (_, params: { selectedIds: string[] }) => params.selectedIds,
    }),
    printRemovalSelectionCancelled: ({ context }) => {
      context.ui.printInfo("No persisted locations selected for removal.");
    },
    storeRemovalOutcome: assign({
      removalOutcome: (_, params: RemovalOutcome) => params,
      persistedLocations: ({ context }) =>
        context.persistedLocations.filter(location => !context.selectedRemovalIds.includes(location.id)),
      selectedRemovalIds: () => [],
    }),
    printRemovalOutcome: ({ context }) => {
      context.ui.printSuccess(
        `Removed ${context.removalOutcome.removedCount} location(s). Missing during delete: ${context.removalOutcome.missingCount}.`,
      );
    },
    setFatalError: assign({
      fatalError: (_, params: { error: unknown }) => toErrorMessage(params.error),
    }),
    printFatalError: ({ context }) => {
      context.ui.printError(`Location workflow failed: ${context.fatalError ?? "Unknown error"}`);
    },
  },
  actors: {
    promptLocationAction: fromPromise(async ({ input }: { input: { ui: TuiUi } }) => {
      input.ui.printHeader("Location persistence");
      input.ui.printInfo("Lookup locations, persist them with an optional nickname, view saved entries, or remove multiple entries.");
      input.ui.printInfo("Choose what to do with persisted locations.");
      return input.ui.chooseLocationAction();
    }),
    promptLookupQuery: fromPromise(async ({ input }: { input: { ui: TuiUi } }) => {
      return input.ui.askLookupQuery();
    }),
    runLookup: fromPromise(
      async ({ input }: { input: { service: Pick<TimeInPlaceService, "lookupLocations">; query: string } }) => {
        return input.service.lookupLocations(input.query, { limit: 5 });
      },
    ),
    promptLookupResult: fromPromise(async ({ input }: { input: { ui: TuiUi; results: LocationMatch[] } }) => {
      return input.ui.chooseLookupResult(input.results);
    }),
    promptNickname: fromPromise(async ({ input }: { input: { ui: TuiUi; defaultNickname: string } }) => {
      return input.ui.askNickname(input.defaultNickname);
    }),
    persistSelectedLocation: fromPromise(
      async ({
        input,
      }: {
        input: {
          store: PersistedLocationStoreLike;
          selectedResult: LocationMatch | null;
          nickname: string;
        };
      }) => {
        if (!input.selectedResult) {
          throw new Error("No selected location available for persistence.");
        }

        return input.store.add({
          name: input.selectedResult.name,
          coords: input.selectedResult.coords,
          nickname: input.nickname,
        });
      },
    ),
    listPersistedLocations: fromPromise(async ({ input }: { input: { store: PersistedLocationStoreLike } }) => {
      return input.store.list();
    }),
    promptRemovalSelection: fromPromise(
      async ({ input }: { input: { ui: TuiUi; locations: PersistedLocation[] } }) => {
        return input.ui.chooseRemovalIds(input.locations);
      },
    ),
    removePersistedLocations: fromPromise(
      async ({ input }: { input: { store: PersistedLocationStoreLike; ids: string[] } }): Promise<RemovalOutcome> => {
        let removedCount = 0;
        let missingCount = 0;

        for (const id of input.ids) {
          const removed = await input.store.remove(id);
          if (removed) {
            removedCount += 1;
          } else {
            missingCount += 1;
          }
        }

        return { removedCount, missingCount };
      },
    ),
  },
}).createMachine({
  id: "locationManagement",
  context: ({ input }) => ({
    service: input.service,
    store: input.store,
    ui: input.ui,
    query: "",
    lookupResults: [],
    selectedResult: null,
    nickname: "",
    persistedLocations: [],
    selectedRemovalIds: [],
    removalOutcome: {
      removedCount: 0,
      missingCount: 0,
    },
    fatalError: null,
  }),
  initial: "menu",
  states: {
    menu: {
      invoke: {
        src: "promptLocationAction",
        input: ({ context }) => ({ ui: context.ui }),
        onDone: [
          {
            guard: {
              type: "menuChoiceLookup",
              params: ({ event }) => ({ choice: event.output }),
            },
            target: "lookupQuery",
          },
          {
            guard: {
              type: "menuChoiceView",
              params: ({ event }) => ({ choice: event.output }),
            },
            target: "viewRun",
          },
          {
            guard: {
              type: "menuChoiceRemove",
              params: ({ event }) => ({ choice: event.output }),
            },
            target: "removeLoad",
          },
          {
            guard: {
              type: "menuChoiceBack",
              params: ({ event }) => ({ choice: event.output }),
            },
            actions: "printLocationExit",
            target: "done",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    lookupQuery: {
      invoke: {
        src: "promptLookupQuery",
        input: ({ context }) => ({ ui: context.ui }),
        onDone: [
          {
            guard: {
              type: "emptyLookupQuery",
              params: ({ event }) => ({ query: event.output }),
            },
            actions: "printEmptyLookupQuery",
            target: "menu",
          },
          {
            actions: {
              type: "storeLookupQuery",
              params: ({ event }) => ({ query: event.output }),
            },
            target: "lookupRun",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    lookupRun: {
      invoke: {
        src: "runLookup",
        input: ({ context }) => ({
          service: context.service,
          query: context.query,
        }),
        onDone: [
          {
            guard: {
              type: "noLookupResults",
              params: ({ event }) => ({ count: event.output.length }),
            },
            actions: [
              {
                type: "storeLookupResults",
                params: ({ event }) => ({ results: event.output }),
              },
              "printNoLookupResults",
            ],
            target: "menu",
          },
          {
            actions: {
              type: "storeLookupResults",
              params: ({ event }) => ({ results: event.output }),
            },
            target: "chooseResult",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    chooseResult: {
      always: {
        guard: "singleLookupResult",
        actions: ["autoSelectOnlyResult", "printAutoSelection"],
        target: "nicknamePrompt",
      },
      invoke: {
        src: "promptLookupResult",
        input: ({ context }) => ({
          ui: context.ui,
          results: context.lookupResults,
        }),
        onDone: [
          {
            guard: {
              type: "resultSelectionCancelled",
              params: ({ event }) => ({ index: event.output }),
            },
            actions: "printLookupSelectionCancelled",
            target: "menu",
          },
          {
            actions: {
              type: "storeSelectedResultFromPrompt",
              params: ({ event }) => ({ index: event.output as number }),
            },
            target: "nicknamePrompt",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    nicknamePrompt: {
      invoke: {
        src: "promptNickname",
        input: ({ context }) => ({
          ui: context.ui,
          defaultNickname: context.query,
        }),
        onDone: [
          {
            guard: {
              type: "nicknameCancelled",
              params: ({ event }) => ({ nickname: event.output }),
            },
            actions: "printNicknameCancelled",
            target: "menu",
          },
          {
            actions: {
              type: "storeNickname",
              params: ({ event }) => ({ nickname: event.output }),
            },
            target: "persistRun",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    persistRun: {
      invoke: {
        src: "persistSelectedLocation",
        input: ({ context }) => ({
          store: context.store,
          selectedResult: context.selectedResult,
          nickname: context.nickname,
        }),
        onDone: {
          actions: [
            {
              type: "storePersistOutcome",
              params: ({ event }) => ({ persisted: event.output }),
            },
            {
              type: "printPersistSuccess",
              params: ({ event }) => ({ persisted: event.output }),
            },
          ],
          target: "menu",
        },
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    viewRun: {
      invoke: {
        src: "listPersistedLocations",
        input: ({ context }) => ({ store: context.store }),
        onDone: {
          actions: [
            {
              type: "storePersistedLocations",
              params: ({ event }) => ({ locations: event.output }),
            },
            "printPersistedLocations",
          ],
          target: "menu",
        },
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    removeLoad: {
      invoke: {
        src: "listPersistedLocations",
        input: ({ context }) => ({ store: context.store }),
        onDone: [
          {
            guard: {
              type: "noPersistedForRemoval",
              params: ({ event }) => ({ count: event.output.length }),
            },
            actions: [
              {
                type: "storePersistedLocations",
                params: ({ event }) => ({ locations: event.output }),
              },
              "printNoPersistedToRemove",
            ],
            target: "menu",
          },
          {
            actions: {
              type: "storePersistedLocations",
              params: ({ event }) => ({ locations: event.output }),
            },
            target: "removeChoose",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    removeChoose: {
      invoke: {
        src: "promptRemovalSelection",
        input: ({ context }) => ({
          ui: context.ui,
          locations: context.persistedLocations,
        }),
        onDone: [
          {
            guard: {
              type: "noRemovalSelection",
              params: ({ event }) => ({ selectedIds: event.output }),
            },
            actions: "printRemovalSelectionCancelled",
            target: "menu",
          },
          {
            actions: {
              type: "storeSelectedRemovalIds",
              params: ({ event }) => ({ selectedIds: event.output }),
            },
            target: "removeRun",
          },
        ],
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    removeRun: {
      invoke: {
        src: "removePersistedLocations",
        input: ({ context }) => ({
          store: context.store,
          ids: context.selectedRemovalIds,
        }),
        onDone: {
          actions: [
            {
              type: "storeRemovalOutcome",
              params: ({ event }) => event.output,
            },
            "printRemovalOutcome",
          ],
          target: "menu",
        },
        onError: {
          actions: {
            type: "setFatalError",
            params: ({ event }) => ({ error: event.error }),
          },
          target: "failed",
        },
      },
    },

    done: {
      type: "final",
      output: () => ({ status: "completed" as const }),
    },

    failed: {
      entry: "printFatalError",
      type: "final",
      output: ({ context }) => ({
        status: "failed" as const,
        error: context.fatalError ?? "Unknown location workflow failure",
      }),
    },
  },
});
