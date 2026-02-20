import type { PersistedLocation } from "../lib/time-in-place";
import type { LocationMatch } from "../lib/time-in-place";

export type AppFeatureChoice = "location" | "exit";

export type LocationActionChoice = "lookup" | "view" | "remove" | "back";

export interface TuiUi {
  printHeader(title: string): void;
  printInfo(message: string): void;
  printSuccess(message: string): void;
  printWarning(message: string): void;
  printError(message: string): void;

  chooseAppFeature(): Promise<AppFeatureChoice>;
  chooseLocationAction(): Promise<LocationActionChoice>;
  askLookupQuery(): Promise<string>;
  chooseLookupResult(results: LocationMatch[]): Promise<number | null>;
  askNickname(defaultNickname: string): Promise<string | null>;
  chooseRemovalIds(locations: PersistedLocation[]): Promise<string[]>;
}
