import "../home-clock-tailwind.css";
import { useEffect, useMemo, useState } from "react";
import { ReactMainline } from "react-mainline";
import { CenterReadout } from "./home-clock/CenterReadout";
import { HomeClockShell } from "./home-clock/HomeClockShell";
import { HourTickLayer } from "./home-clock/HourTickLayer";
import { OrbitLabelSystem } from "./home-clock/OrbitLabelSystem";
import { SkyRingLayers } from "./home-clock/SkyRingLayers";
import { useHomeClockModel } from "./useHomeClockModel";
import { createSameSkyMainlineAdapter } from "../features/mainline/sameSkyMainlineAdapter";
import { useLocationProfiles } from "../features/mainline/useLocationProfiles";
import { useMainlineSettings } from "../features/mainline/useMainlineSettings";

export function HomeClockTailwindPage() {
  const settings = useMainlineSettings();
  const [visibleLocationIds, setVisibleLocationIds] = useState<
    readonly string[] | undefined
  >(undefined);

  const model = useHomeClockModel({
    secondOrderEnabled: settings.secondOrderEnabled,
    visibleLocationIds,
  });

  const profiles = useLocationProfiles({
    savedLocationIds: model.savedLocations.map((location) => location.id),
    hasLoadedSavedLocations: model.hasLoadedSavedLocations,
    activeProfileId: settings.activeProfileId,
    onActiveProfileIdChange: settings.setActiveProfileId,
  });

  const visibleIdsKey = profiles.visibleLocationIds.join("|");
  useEffect(() => {
    setVisibleLocationIds((prev) => {
      const prevKey = (prev ?? []).join("|");
      if (prevKey === visibleIdsKey) {
        return prev;
      }

      return [...profiles.visibleLocationIds];
    });
  }, [profiles.visibleLocationIds, visibleIdsKey]);

  const mainlineAdapter = useMemo(() => {
    return createSameSkyMainlineAdapter({
      savedLocations: model.savedLocations,
      activeProfile: profiles.activeProfile,
      profiles: profiles.profiles,
      secondOrderEnabled: settings.secondOrderEnabled,
      setSecondOrderEnabled: settings.setSecondOrderEnabled,
      setSelectedId: model.setSelectedId,
      reloadSavedLocations: model.reloadSavedLocations,
      setActiveProfile: profiles.setActiveProfile,
      createProfile: profiles.createProfile,
      renameProfile: profiles.renameProfile,
      deleteProfile: profiles.deleteProfile,
      addLocationToActiveProfile: profiles.addLocationToActiveProfile,
      removeLocationEverywhere: profiles.removeLocationEverywhere,
    });
  }, [
    model.savedLocations,
    model.setSelectedId,
    model.reloadSavedLocations,
    profiles.activeProfile,
    profiles.profiles,
    profiles.setActiveProfile,
    profiles.createProfile,
    profiles.renameProfile,
    profiles.deleteProfile,
    profiles.addLocationToActiveProfile,
    profiles.removeLocationEverywhere,
    settings.secondOrderEnabled,
    settings.setSecondOrderEnabled,
  ]);

  return (
    <>
      <ReactMainline adapter={mainlineAdapter} />
      <HomeClockShell
        ringFrameRef={model.ringFrameRef}
        conceptVars={model.conceptVars}
      >
        <SkyRingLayers
          wheelRotation={model.wheelRotation}
          isRingTransitioning={model.isRingTransitioning}
          displayedWheelGradient={model.displayedWheelGradient}
          displayedNightMaskGradient={model.displayedNightMaskGradient}
        />

        <CenterReadout
          centerCopyTransitionKey={model.centerCopyTransitionKey}
          selectedCopyLabel={model.selectedCopyLabel}
          centerTimeParts={model.centerTimeParts}
          displayCenterTime={model.displayCenterTime}
          centerUtcOffsetParts={model.centerUtcOffsetParts}
          shouldAnimateHour={model.shouldAnimateHour}
          shouldAnimateMinute={model.shouldAnimateMinute}
          shouldAnimateUtcHours={model.shouldAnimateUtcHours}
          shouldAnimateUtcMinutes={model.shouldAnimateUtcMinutes}
          ringError={model.ringError}
        />

        <HourTickLayer
          wheelRotation={model.wheelRotation}
          isRingTransitioning={model.isRingTransitioning}
          areHourTicksVisible={model.areHourTicksVisible}
        />

        <OrbitLabelSystem
          orbitLabelLayout={model.orbitLabelLayout}
          isRingTransitioning={model.isRingTransitioning}
          setSelectedId={model.setSelectedId}
        />

        {model.orbitLabels.length === 0 ? (
          <p
            className="absolute left-1/2 z-16 m-0 max-w-[92%] rounded-full border border-dashed border-[#9ecce45f] bg-[#0b1d2be4] px-[0.8rem] py-2 text-center text-[0.68rem] tracking-[0.02em] text-[#d7e9f5] sm:max-w-none sm:whitespace-nowrap sm:text-[0.76rem]"
            style={{
              top: "calc(50% + (var(--ring-size) * 0.33))",
              transform: "translate(-50%, -50%)",
            }}
          >
            No saved locations yet. The ring follows your current timezone.
          </p>
        ) : null}
      </HomeClockShell>
    </>
  );
}

export default HomeClockTailwindPage;
