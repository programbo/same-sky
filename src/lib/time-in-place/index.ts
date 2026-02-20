import { createTimeInPlaceService } from "./service";

export * from "./types";
export * from "./contracts";
export * from "./cache";
export * from "./math";
export * from "./providers";
export * from "./service";
export * from "./persisted-locations";

const defaultService = createTimeInPlaceService();

export const lookupLocations = defaultService.lookupLocations.bind(defaultService);
export const getCurrentLocation = defaultService.getCurrentLocation.bind(defaultService);
export const getTimeForLocation = defaultService.getTimeForLocation.bind(defaultService);
export const getOffsetForLocation = defaultService.getOffsetForLocation.bind(defaultService);
export const getAngleForOffset = defaultService.getAngleForOffset.bind(defaultService);
export const getAngleForLocation = defaultService.getAngleForLocation.bind(defaultService);

export const locationLookup = defaultService.locationLookup.bind(defaultService);
export const currentLocation = defaultService.currentLocation.bind(defaultService);
export const timeInLocation = defaultService.timeInLocation.bind(defaultService);
export const angleForLocation = defaultService.angleForLocation.bind(defaultService);
export const timeOffsetForLocation = defaultService.timeOffsetForLocation.bind(defaultService);
export const angleForTimeOffset = defaultService.angleForTimeOffset.bind(defaultService);
