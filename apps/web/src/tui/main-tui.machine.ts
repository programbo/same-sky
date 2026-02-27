import { assign, fromPromise, setup } from "xstate";
import type { PersistedLocationStoreLike, SameSkyService } from "../lib/same-sky";
import { locationManagementMachine } from "./location-management.machine";
import type { AppFeatureChoice, TuiUi } from "./ui-contract";

interface MainTuiContext {
  argv: string[];
  verbose: boolean;
  ui: TuiUi;
  service: SameSkyService;
  store: PersistedLocationStoreLike;
  fatalError: string | null;
}

interface MainTuiInput {
  argv: string[];
  verbose?: boolean;
  ui: TuiUi;
  service: SameSkyService;
  store: PersistedLocationStoreLike;
}

type MainTuiEvent = { type: "APP.NOOP" };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

export const mainTuiMachine = setup({
  types: {
    context: {} as MainTuiContext,
    events: {} as MainTuiEvent,
    input: {} as MainTuiInput,
    output: {} as { status: "completed" } | { status: "failed"; error: string },
  },
  guards: {
    bypassLocationFromArg: ({ context }) => {
      const firstArg = context.argv[0]?.trim().toLowerCase();
      return firstArg === "location";
    },
    featureIsLocation: (_, params: { feature: AppFeatureChoice }) => params.feature === "location",
    featureIsExit: (_, params: { feature: AppFeatureChoice }) => params.feature === "exit",
  },
  actions: {
    printExitSelected: ({ context }) => {
      context.ui.printInfo("Exiting app feature tests.");
    },
    printAppComplete: ({ context }) => {
      context.ui.printSuccess("TUI session complete.");
    },
    setFatalError: assign({
      fatalError: (_, params: { error: unknown }) => toErrorMessage(params.error),
    }),
    printFatalError: ({ context }) => {
      context.ui.printError(`TUI failed: ${context.fatalError ?? "Unknown error"}`);
    },
  },
  actors: {
    // Keep prompt-related header rendering in the same actor that opens the prompt.
    // This avoids stdout interleaving where parent-state logs appear after child prompts.
    promptFeatureMenu: fromPromise(async ({ input }: { input: { ui: TuiUi } }) => {
      input.ui.printHeader("App feature tests");
      input.ui.printInfo("Select a feature to test in this TUI.");
      return input.ui.chooseAppFeature();
    }),
    locationWorkflow: locationManagementMachine,
  },
}).createMachine({
  id: "mainTui",
  context: ({ input }) => ({
    argv: input.argv,
    verbose: input.verbose ?? false,
    ui: input.ui,
    service: input.service,
    store: input.store,
    fatalError: null,
  }),
  initial: "entry",
  states: {
    entry: {
      always: [
        {
          guard: "bypassLocationFromArg",
          target: "locationFeature",
        },
        {
          target: "featureMenu",
        },
      ],
    },

    featureMenu: {
      invoke: {
        src: "promptFeatureMenu",
        input: ({ context }) => ({ ui: context.ui }),
        onDone: [
          {
            guard: {
              type: "featureIsExit",
              params: ({ event }) => ({ feature: event.output }),
            },
            actions: ["printExitSelected", "printAppComplete"],
            target: "done",
          },
          {
            guard: {
              type: "featureIsLocation",
              params: ({ event }) => ({ feature: event.output }),
            },
            target: "locationFeature",
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

    locationFeature: {
      invoke: {
        src: "locationWorkflow",
        input: ({ context }) => ({
          service: context.service,
          store: context.store,
          ui: context.ui,
          verbose: context.verbose,
        }),
        onDone: {
          target: "featureMenu",
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
        error: context.fatalError ?? "Unknown TUI failure",
      }),
    },
  },
});
