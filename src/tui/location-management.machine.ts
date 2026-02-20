import { assign, fromPromise, setup } from "xstate";
import type {
  BoundingBox,
  LocationMatch,
  PersistedLocation,
  PersistedLocationStoreLike,
  TimeInPlaceService,
} from "../lib/time-in-place";
import { isLocationSelectableForSky } from "../lib/time-in-place";
import type { LocationActionChoice, RefinementActionChoice, TuiUi } from "./ui-contract";

const REQUIRE_LOCALITY_FOR_PERSIST = (process.env.REQUIRE_LOCALITY_FOR_PERSIST ?? "true").toLowerCase() !== "false";
const FORCE_REFINEMENT_DIAGONAL_KM = 300;
const WARN_REFINEMENT_DIAGONAL_KM = 50;
const SMALL_AREA_AUTO_ALLOW_KM = 150;

interface RemovalOutcome {
  removedCount: number;
  missingCount: number;
}

interface LocationMachineContext {
  service: Pick<TimeInPlaceService, "lookupLocations" | "getTimeForLocation">;
  store: PersistedLocationStoreLike;
  ui: TuiUi;
  verbose: boolean;
  query: string;
  lookupResults: LocationMatch[];
  selectedResult: LocationMatch | null;
  lookupScopeBoundingBox: BoundingBox | null;
  lookupScopeLabel: string | null;
  lookupScopeSeedQuery: string;
  lookupLocalityOnly: boolean;
  nickname: string;
  persistedLocations: PersistedLocation[];
  selectedRemovalIds: string[];
  removalOutcome: RemovalOutcome;
  selectionAnalysis: SelectionAnalysis | null;
  fatalError: string | null;
}

interface LocationMachineInput {
  service: Pick<TimeInPlaceService, "lookupLocations" | "getTimeForLocation">;
  store: PersistedLocationStoreLike;
  ui: TuiUi;
  verbose?: boolean;
}

type LocationMachineEvent = { type: "LOCATION.NOOP" };

type RefinementReason = "timezone_ambiguous" | "boundary_large" | "non_locality";

interface SelectionAnalysis {
  requiresRefinement: boolean;
  reason: RefinementReason | null;
  timezoneCount: number;
  diagonalKm: number | null;
  warnLargeButAllowed: boolean;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function granularityToLabel(granularity: string): string {
  return granularity.replaceAll("_", " ");
}

function formatLocation(match: LocationMatch): string {
  const timezone = match.timezonePreview ?? "timezone unavailable";
  return `${match.name} [${match.granularity}] (${match.coords.lat.toFixed(4)}, ${match.coords.long.toFixed(4)}) TZ: ${timezone}`;
}

function formatPersisted(location: PersistedLocation): string {
  const nicknamePart = location.nickname ? ` | ${location.nickname}` : "";
  const timezonePart = location.timezone ? ` | ${location.timezone}` : "";
  return `${location.name}${nicknamePart}${timezonePart} [${location.id}]`;
}

function formatScopeLabel(match: LocationMatch): string {
  const parts = [match.admin.country, match.admin.region, match.name].filter(
    (value): value is string => Boolean(value && value.trim().length > 0),
  );

  return parts.length > 0 ? parts.join(" > ") : match.name;
}

function emitMetric(
  enabled: boolean,
  name: string,
  fields: Record<string, string | number | boolean | undefined>,
): void {
  if (!enabled) {
    return;
  }

  console.info(`[metric] ${name} ${JSON.stringify(fields)}`);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function boundingBoxDiagonalKm(bbox: BoundingBox | undefined): number | null {
  if (!bbox) {
    return null;
  }

  return haversineKm(bbox.south, bbox.west, bbox.north, bbox.east);
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
    refinementChoiceBrowse: (_, params: { choice: RefinementActionChoice }) => params.choice === "browse",
    refinementChoiceSearch: (_, params: { choice: RefinementActionChoice }) => params.choice === "search",
    refinementChoiceRestart: (_, params: { choice: RefinementActionChoice }) => params.choice === "restart",
    emptyLookupQuery: (_, params: { query: string }) => params.query.trim().length === 0,
    emptyLookupQueryInScoped: ({ context }, params: { query: string }) =>
      params.query.trim().length === 0 && context.lookupLocalityOnly,
    noLookupResultsInScoped: ({ context }, params: { count: number }) =>
      params.count === 0 && context.lookupLocalityOnly,
    noLookupResults: (_, params: { count: number }) => params.count === 0,
    singleLookupResult: ({ context }) => context.lookupResults.length === 1,
    resultSelectionCancelled: (_, params: { index: number | null }) => params.index === null,
    resultSelectionCancelledInScoped: ({ context }, params: { index: number | null }) =>
      params.index === null && context.lookupLocalityOnly,
    nicknameCancelled: (_, params: { nickname: string | null }) => params.nickname === null,
    noPersistedForRemoval: (_, params: { count: number }) => params.count === 0,
    noRemovalSelection: (_, params: { selectedIds: string[] }) => params.selectedIds.length === 0,
    hasSelectedResult: ({ context }) => context.selectedResult !== null,
    analysisRequiresNarrowing: (_, params: { analysis: SelectionAnalysis }) => {
      if (!REQUIRE_LOCALITY_FOR_PERSIST) {
        return false;
      }

      return params.analysis.requiresRefinement;
    },
    analysisWarnOnly: (_, params: { analysis: SelectionAnalysis }) => params.analysis.warnLargeButAllowed,
  },
  actions: {
    printLocationExit: ({ context }) => {
      context.ui.printInfo("Leaving location persistence.");
    },
    resetLookupScope: assign({
      query: () => "",
      lookupScopeBoundingBox: () => null,
      lookupScopeLabel: () => null,
      lookupScopeSeedQuery: () => "",
      lookupLocalityOnly: () => false,
      lookupResults: () => [],
      selectedResult: () => null,
      nickname: () => "",
      selectionAnalysis: () => null,
    }),
    storeLookupQuery: assign({
      query: (_, params: { query: string }) => params.query.trim(),
      selectedResult: () => null,
      nickname: () => "",
      selectionAnalysis: () => null,
    }),
    printEmptyLookupQuery: ({ context }) => {
      if (context.lookupLocalityOnly) {
        context.ui.printWarning("Search query cannot be empty. Enter a city/suburb/town within the selected area.");
        return;
      }

      context.ui.printWarning("Search query cannot be empty.");
    },
    storeLookupResults: assign({
      lookupResults: (_, params: { results: LocationMatch[] }) => params.results,
      selectedResult: () => null,
    }),
    printNoLookupResults: ({ context }) => {
      if (context.lookupLocalityOnly) {
        const scope = context.lookupScopeLabel ? ` within ${context.lookupScopeLabel}` : "";
        context.ui.printWarning(`No locality-level locations found${scope} for "${context.query}". Try nearby city/suburb names.`);
        return;
      }

      context.ui.printWarning(`No locations found for "${context.query}".`);
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
      selectionAnalysis: () => null,
    }),
    printLookupSelectionCancelled: ({ context }) => {
      context.ui.printInfo("Lookup selection cancelled.");
    },
    storeSelectionAnalysis: assign({
      selectionAnalysis: (_, params: { analysis: SelectionAnalysis }) => params.analysis,
    }),
    prepareRefinementFromSelection: assign({
      lookupScopeBoundingBox: ({ context }) => context.selectedResult?.boundingBox ?? null,
      lookupScopeLabel: ({ context }) => {
        const selected = context.selectedResult;
        return selected ? formatScopeLabel(selected) : context.lookupScopeLabel;
      },
      lookupScopeSeedQuery: ({ context }) => context.selectedResult?.name ?? context.lookupScopeSeedQuery,
      lookupLocalityOnly: () => true,
      lookupResults: () => [],
      selectedResult: () => null,
      nickname: () => "",
      query: () => "",
      selectionAnalysis: () => null,
    }),
    setLookupQueryFromScopeSeed: assign({
      query: ({ context }) => context.lookupScopeSeedQuery,
      selectedResult: () => null,
      selectionAnalysis: () => null,
    }),
    printSelectionNeedsNarrowing: ({ context }) => {
      const selected = context.selectedResult;
      if (!selected) {
        return;
      }

      const reason = context.selectionAnalysis?.reason;
      const diagonalKm = context.selectionAnalysis?.diagonalKm;
      const timezoneCount = context.selectionAnalysis?.timezoneCount;

      if (reason === "timezone_ambiguous" && timezoneCount && timezoneCount > 1) {
        context.ui.printWarning(
          `This selection spans ${timezoneCount} timezones; choose a city/suburb within it.`,
        );
      } else if (reason === "boundary_large" && diagonalKm !== null && diagonalKm !== undefined) {
        context.ui.printWarning(
          `This selection spans about ${Math.round(diagonalKm)} km; choose a city/suburb for better sky-color accuracy.`,
        );
      } else {
        context.ui.printWarning(
          `This selection is ${granularityToLabel(selected.granularity)}-level; choose a city/suburb within it.`,
        );
      }

      const scopeLabel = formatScopeLabel(selected);
      emitMetric(context.verbose, "lookup_selected_granularity", { granularity: selected.granularity });
      emitMetric(context.verbose, "narrowing_required_count", { granularity: selected.granularity });
      context.ui.printInfo(`Refinement scope: ${scopeLabel}`);
    },
    printSelectionWarningOnly: ({ context }) => {
      const diagonalKm = context.selectionAnalysis?.diagonalKm;
      if (diagonalKm !== null && diagonalKm !== undefined) {
        context.ui.printInfo(
          `This area is about ${Math.round(diagonalKm)} km across; you can continue, but refining to a suburb may improve accuracy.`,
        );
      }
    },
    storeNickname: assign({
      nickname: ({ context }, params: { nickname: string | null }) => {
        const raw = params.nickname?.trim() ?? "";
        const fallback = context.selectedResult?.name ?? context.query;
        return raw.length > 0 ? raw : fallback;
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
      const defaultNickname = context.selectedResult?.name ?? context.query;
      if (defaultNickname.trim().length > 0) {
        context.ui.printInfo(`Nickname default source: "${defaultNickname}"`);
      }
      emitMetric(context.verbose, "persist_with_locality_rate", {
        granularity: params.persisted.granularity ?? "unknown",
      });
      if (context.lookupLocalityOnly) {
        emitMetric(context.verbose, "narrowing_success_rate", {
          granularity: params.persisted.granularity ?? "unknown",
        });
      }
      context.ui.printInfo("Optional: run lookup again and choose a suburb/neighborhood to improve sky-color precision further.");
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
      input.ui.printInfo("Some broad regions require narrowing to a city/suburb when ambiguity is materially high.");
      return input.ui.chooseLocationAction();
    }),
    promptLookupQuery: fromPromise(
      async ({ input }: { input: { ui: TuiUi; lookupLocalityOnly: boolean; lookupScopeLabel: string | null } }) => {
        const scope = input.lookupScopeLabel ? ` within ${input.lookupScopeLabel}` : "";
        const message = input.lookupLocalityOnly ? `Search city/suburb${scope}` : "Search query";
        return input.ui.askLookupQuery(message);
      },
    ),
    promptRefinementAction: fromPromise(
      async ({ input }: { input: { ui: TuiUi; lookupScopeLabel: string | null } }) => {
        return input.ui.chooseRefinementAction(input.lookupScopeLabel ?? "selected area");
      },
    ),
    runLookup: fromPromise(
      async ({
        input,
      }: {
        input: {
          service: Pick<TimeInPlaceService, "lookupLocations">;
          query: string;
          scopeBoundingBox: BoundingBox | null;
          localityOnly: boolean;
        };
      }) => {
        return input.service.lookupLocations(input.query, {
          limit: 5,
          scopeBoundingBox: input.scopeBoundingBox ?? undefined,
          localityOnly: input.localityOnly,
        });
      },
    ),
    promptLookupResult: fromPromise(async ({ input }: { input: { ui: TuiUi; results: LocationMatch[] } }) => {
      return input.ui.chooseLookupResult(input.results);
    }),
    analyzeSelection: fromPromise(
      async ({
        input,
      }: {
        input: {
          service: Pick<TimeInPlaceService, "getTimeForLocation">;
          selectedResult: LocationMatch | null;
        };
      }): Promise<SelectionAnalysis> => {
        const selected = input.selectedResult;
        if (!selected) {
          return {
            requiresRefinement: false,
            reason: null,
            timezoneCount: 0,
            diagonalKm: null,
            warnLargeButAllowed: false,
          };
        }

        const diagonalKm = boundingBoxDiagonalKm(selected.boundingBox);
        if (isLocationSelectableForSky(selected)) {
          return {
            requiresRefinement: false,
            reason: null,
            timezoneCount: selected.timezonePreview ? 1 : 0,
            diagonalKm,
            warnLargeButAllowed: false,
          };
        }

        if (!selected.boundingBox) {
          return {
            requiresRefinement: true,
            reason: "non_locality",
            timezoneCount: selected.timezonePreview ? 1 : 0,
            diagonalKm: null,
            warnLargeButAllowed: false,
          };
        }

        if (diagonalKm !== null && diagonalKm <= SMALL_AREA_AUTO_ALLOW_KM) {
          return {
            requiresRefinement: false,
            reason: null,
            timezoneCount: selected.timezonePreview ? 1 : 0,
            diagonalKm,
            warnLargeButAllowed: diagonalKm > WARN_REFINEMENT_DIAGONAL_KM,
          };
        }

        const { south, north, west, east } = selected.boundingBox;
        const centerLat = (south + north) / 2;
        const centerLong = (west + east) / 2;
        const samplePoints = [
          { lat: centerLat, long: centerLong },
          { lat: north, long: west },
          { lat: north, long: east },
          { lat: south, long: west },
          { lat: south, long: east },
        ];

        const timezoneSet = new Set<string>();
        for (const point of samplePoints) {
          try {
            const resolved = await input.service.getTimeForLocation(point);
            if (resolved.timezone) {
              timezoneSet.add(resolved.timezone);
            }
          } catch {
            // Best-effort only; failures are treated as unknown points.
          }
        }

        const timezoneCount = timezoneSet.size;
        if (timezoneCount > 1) {
          return {
            requiresRefinement: true,
            reason: "timezone_ambiguous",
            timezoneCount,
            diagonalKm,
            warnLargeButAllowed: false,
          };
        }

        if (diagonalKm !== null && diagonalKm > FORCE_REFINEMENT_DIAGONAL_KM) {
          return {
            requiresRefinement: true,
            reason: "boundary_large",
            timezoneCount,
            diagonalKm,
            warnLargeButAllowed: false,
          };
        }

        const warnLargeButAllowed = diagonalKm !== null && diagonalKm > WARN_REFINEMENT_DIAGONAL_KM;
        return {
          requiresRefinement: false,
          reason: null,
          timezoneCount,
          diagonalKm,
          warnLargeButAllowed,
        };
      },
    ),
    promptNickname: fromPromise(async ({ input }: { input: { ui: TuiUi; defaultNickname: string } }) => {
      return input.ui.askNickname(input.defaultNickname);
    }),
    persistSelectedLocation: fromPromise(
      async ({
        input,
      }: {
        input: {
          service: Pick<TimeInPlaceService, "getTimeForLocation">;
          store: PersistedLocationStoreLike;
          selectedResult: LocationMatch | null;
          nickname: string;
        };
      }) => {
        if (!input.selectedResult) {
          throw new Error("No selected location available for persistence.");
        }

        let timezone = input.selectedResult.timezonePreview;
        if (!timezone) {
          try {
            timezone = (await input.service.getTimeForLocation(input.selectedResult.coords)).timezone;
          } catch {
            timezone = undefined;
          }
        }

        return input.store.add({
          name: input.selectedResult.name,
          coords: input.selectedResult.coords,
          nickname: input.nickname,
          timezone,
          granularity: input.selectedResult.granularity,
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
    verbose: input.verbose ?? false,
    query: "",
    lookupResults: [],
    selectedResult: null,
    lookupScopeBoundingBox: null,
    lookupScopeLabel: null,
    lookupScopeSeedQuery: "",
    lookupLocalityOnly: false,
    nickname: "",
    persistedLocations: [],
    selectedRemovalIds: [],
    removalOutcome: {
      removedCount: 0,
      missingCount: 0,
    },
    selectionAnalysis: null,
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
            actions: "resetLookupScope",
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
        input: ({ context }) => ({
          ui: context.ui,
          lookupLocalityOnly: context.lookupLocalityOnly,
          lookupScopeLabel: context.lookupScopeLabel,
        }),
        onDone: [
          {
            guard: {
              type: "emptyLookupQueryInScoped",
              params: ({ event }) => ({ query: event.output }),
            },
            actions: "printEmptyLookupQuery",
            target: "lookupQuery",
          },
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

    refinementMenu: {
      invoke: {
        src: "promptRefinementAction",
        input: ({ context }) => ({
          ui: context.ui,
          lookupScopeLabel: context.lookupScopeLabel,
        }),
        onDone: [
          {
            guard: {
              type: "refinementChoiceBrowse",
              params: ({ event }) => ({ choice: event.output }),
            },
            actions: "setLookupQueryFromScopeSeed",
            target: "lookupRun",
          },
          {
            guard: {
              type: "refinementChoiceSearch",
              params: ({ event }) => ({ choice: event.output }),
            },
            target: "lookupQuery",
          },
          {
            guard: {
              type: "refinementChoiceRestart",
              params: ({ event }) => ({ choice: event.output }),
            },
            actions: "resetLookupScope",
            target: "lookupQuery",
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
          scopeBoundingBox: context.lookupScopeBoundingBox,
          localityOnly: context.lookupLocalityOnly,
        }),
        onDone: [
          {
            guard: {
              type: "noLookupResultsInScoped",
              params: ({ event }) => ({ count: event.output.length }),
            },
            actions: [
              {
                type: "storeLookupResults",
                params: ({ event }) => ({ results: event.output }),
              },
              "printNoLookupResults",
            ],
            target: "refinementMenu",
          },
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
        target: "evaluateSelection",
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
              type: "resultSelectionCancelledInScoped",
              params: ({ event }) => ({ index: event.output }),
            },
            actions: "printLookupSelectionCancelled",
            target: "refinementMenu",
          },
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
            target: "evaluateSelection",
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

    evaluateSelection: {
      invoke: {
        src: "analyzeSelection",
        input: ({ context }) => ({
          service: context.service,
          selectedResult: context.selectedResult,
        }),
        onDone: [
          {
            guard: {
              type: "analysisRequiresNarrowing",
              params: ({ event }) => ({ analysis: event.output }),
            },
            actions: [
              {
                type: "storeSelectionAnalysis",
                params: ({ event }) => ({ analysis: event.output }),
              },
              "printSelectionNeedsNarrowing",
              "prepareRefinementFromSelection",
            ],
            target: "refinementMenu",
          },
          {
            guard: {
              type: "analysisWarnOnly",
              params: ({ event }) => ({ analysis: event.output }),
            },
            actions: [
              {
                type: "storeSelectionAnalysis",
                params: ({ event }) => ({ analysis: event.output }),
              },
              "printSelectionWarningOnly",
            ],
            target: "nicknamePrompt",
          },
          {
            guard: "hasSelectedResult",
            actions: {
              type: "storeSelectionAnalysis",
              params: ({ event }) => ({ analysis: event.output }),
            },
            target: "nicknamePrompt",
          },
          {
            actions: {
              type: "storeSelectionAnalysis",
              params: ({ event }) => ({ analysis: event.output }),
            },
            target: "menu",
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
          defaultNickname: context.selectedResult?.name ?? context.query,
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
          service: context.service,
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
            "resetLookupScope",
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
