import type { PersistedLocation } from "../lib/same-sky";
import type { LocationMatch } from "../lib/same-sky";

export type AppFeatureChoice = "location" | "exit";

export type LocationActionChoice = "lookup" | "view" | "remove" | "back";
export type RefinementActionChoice = "browse" | "search" | "restart";

export interface TuiUi {
  printHeader(title: string): void;
  printInfo(message: string): void;
  printSuccess(message: string): void;
  printWarning(message: string): void;
  printError(message: string): void;

  chooseAppFeature(): Promise<AppFeatureChoice>;
  chooseLocationAction(): Promise<LocationActionChoice>;
  chooseRefinementAction(scopeLabel: string): Promise<RefinementActionChoice>;
  askLookupQuery(message?: string): Promise<string>;
  chooseLookupResult(results: LocationMatch[]): Promise<number | null>;
  askNickname(defaultNickname: string): Promise<string | null>;
  chooseRemovalIds(locations: PersistedLocation[]): Promise<string[]>;
}
