import { checkbox, input, select } from "@inquirer/prompts";
import { emitKeypressEvents } from "node:readline";
import { stdin } from "node:process";
import type { LocationMatch, PersistedLocation } from "../lib/time-in-place";
import { formatLocationLabel } from "./location-label";
import type { AppFeatureChoice, LocationActionChoice, RefinementActionChoice, TuiUi } from "./ui-contract";

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function paint(text: string, color: string): string {
  return `${color}${text}${COLOR.reset}`;
}

function withEscLegend(keys: [key: string, action: string][], escAction: string): string {
  return [...keys, ["esc", escAction]].map(([key, action]) => `${key} ${action}`).join(" • ");
}

function isPromptCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "ExitPromptError" ||
    error.name === "AbortPromptError" ||
    error.message.toLowerCase().includes("force closed")
  );
}

async function withEscAbort<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (!stdin.isTTY) {
    const controller = new AbortController();
    return run(controller.signal);
  }

  const controller = new AbortController();
  emitKeypressEvents(stdin);

  const onKeypress = (_character: string, key: { name?: string } | undefined) => {
    if (key?.name === "escape") {
      controller.abort();
    }
  };

  stdin.on("keypress", onKeypress);
  try {
    return await run(controller.signal);
  } finally {
    stdin.off("keypress", onKeypress);
  }
}

async function promptOrFallback<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isPromptCancelled(error)) {
      return fallback;
    }

    throw error;
  }
}

function formatLocationChoice(match: LocationMatch, index: number): { name: string; value: number; description: string } {
  const timezone = match.timezonePreview ?? "Timezone unavailable";
  const localityStatus = match.isLocalityClass ? "ready" : "needs narrowing";
  const label = formatLocationLabel(match);
  return {
    name: `${index + 1}. ${label} [${match.granularity}]`,
    value: index,
    description: `${match.coords.lat.toFixed(4)}, ${match.coords.long.toFixed(4)} | TZ: ${timezone} | ${localityStatus}`,
  };
}

function formatRemovalChoice(location: PersistedLocation): { name: string; value: string; description: string } {
  return {
    name: location.nickname ? `${location.name} (${location.nickname})` : location.name,
    value: location.id,
    description: `${location.coords.lat.toFixed(4)}, ${location.coords.long.toFixed(4)}`,
  };
}

export function createInquirerUi(): TuiUi {
  return {
    printHeader(title) {
      console.log("\n" + paint("=".repeat(64), COLOR.cyan));
      console.log(paint(` ${title}`, `${COLOR.bold}${COLOR.cyan}`));
      console.log(paint("=".repeat(64), COLOR.cyan));
    },
    printInfo(message) {
      console.log(message);
    },
    printSuccess(message) {
      console.log(paint(message, COLOR.green));
    },
    printWarning(message) {
      console.log(paint(message, COLOR.yellow));
    },
    printError(message) {
      console.error(paint(message, COLOR.red));
    },

    async chooseAppFeature(): Promise<AppFeatureChoice> {
      const choice = await promptOrFallback(
        () =>
          withEscAbort(signal =>
            select<AppFeatureChoice>(
              {
                message: "Select app feature to test",
                choices: [
                  { name: "Location persistence", value: "location" },
                  { name: "Exit", value: "exit" },
                ],
                theme: {
                  style: {
                    keysHelpTip: (keys: [string, string][]) => withEscLegend(keys, "exit"),
                  },
                },
              },
              { signal },
            ),
          ),
        "exit",
      );

      return choice;
    },

    async chooseLocationAction(): Promise<LocationActionChoice> {
      return promptOrFallback(
        () =>
          withEscAbort(signal =>
            select<LocationActionChoice>(
              {
                message: "Location persistence actions",
                choices: [
                  { name: "Lookup and persist", value: "lookup" },
                  { name: "View persisted", value: "view" },
                  { name: "Remove persisted", value: "remove" },
                  { name: "Back", value: "back" },
                ],
                theme: {
                  style: {
                    keysHelpTip: (keys: [string, string][]) => withEscLegend(keys, "back"),
                  },
                },
              },
              { signal },
            ),
          ),
        "back",
      );
    },

    async chooseRefinementAction(scopeLabel: string): Promise<RefinementActionChoice> {
      return promptOrFallback(
        () =>
          withEscAbort(signal =>
            select<RefinementActionChoice>(
              {
                message: `Refine selection within ${scopeLabel}`,
                choices: [
                  {
                    name: "Browse locality options in this area",
                    value: "browse",
                    description: "Recommended: show likely city/suburb matches first",
                  },
                  {
                    name: "Search within this area",
                    value: "search",
                    description: "Enter your own query scoped to this boundary",
                  },
                  {
                    name: "Start over with a new top-level search",
                    value: "restart",
                    description: "Discard this refinement path and search again",
                  },
                ],
                theme: {
                  style: {
                    keysHelpTip: (keys: [string, string][]) => withEscLegend(keys, "restart"),
                  },
                },
              },
              { signal },
            ),
          ),
        "restart",
      );
    },

    async askLookupQuery(message = "Search query"): Promise<string> {
      return promptOrFallback(
        () =>
          withEscAbort(signal =>
            input(
              {
                message,
              },
              { signal },
            ),
          ),
        "",
      );
    },

    async chooseLookupResult(results): Promise<number | null> {
      const choice = await promptOrFallback(
        () =>
          withEscAbort(signal =>
            select<number>(
              {
                message: "Select a location to persist",
                choices: [
                  ...results.map(formatLocationChoice),
                  {
                    name: "Back",
                    value: -1,
                    description: "Return to location actions",
                  },
                ],
                theme: {
                  style: {
                    keysHelpTip: (keys: [string, string][]) => withEscLegend(keys, "back"),
                  },
                },
              },
              { signal },
            ),
          ),
        -1,
      );

      if (choice < 0) {
        return null;
      }

      return choice;
    },

    async askNickname(defaultNickname): Promise<string | null> {
      return promptOrFallback(
        () =>
          withEscAbort(signal =>
            input(
              {
                message: `Nickname [${defaultNickname}]`,
                default: defaultNickname,
              },
              { signal },
            ),
          ),
        null,
      );
    },

    async chooseRemovalIds(locations): Promise<string[]> {
      return promptOrFallback(
        () =>
          withEscAbort(signal =>
            checkbox<string>(
              {
                message: "Select persisted locations to remove",
                choices: locations.map(formatRemovalChoice),
                pageSize: 12,
                theme: {
                  style: {
                    keysHelpTip: (keys: [string, string][]) => withEscLegend(keys, "abort"),
                  },
                },
              },
              { signal },
            ),
          ),
        [],
      );
    },
  };
}
