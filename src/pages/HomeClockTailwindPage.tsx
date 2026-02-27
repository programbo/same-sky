import "../home-clock-tailwind.css"
import {
  Text,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastRegion as ToastRegion,
} from "react-aria-components"
import { CenterReadout } from "./home-clock/CenterReadout"
import { HomeClockShell } from "./home-clock/HomeClockShell"
import { HourTickLayer } from "./home-clock/HourTickLayer"
import { OrbitLabelSystem } from "./home-clock/OrbitLabelSystem"
import { enqueueKeyboardHelpToastOnce, keyboardHelpToastQueue, useKeyboardModality } from "./home-clock/keyboardHelpToast"
import { SkyRingLayers } from "./home-clock/SkyRingLayers"
import { useHomeClockModel } from "./useHomeClockModel"

export function HomeClockTailwindPage() {
  const model = useHomeClockModel()
  useKeyboardModality()

  return (
    <HomeClockShell ringFrameRef={model.ringFrameRef} conceptVars={model.conceptVars}>
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
        selectedId={model.selectedId}
        onSelectedIdChange={model.setSelectedId}
        onKeyboardHelpNeeded={enqueueKeyboardHelpToastOnce}
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

      <ToastRegion
        queue={keyboardHelpToastQueue}
        className="pointer-events-none fixed inset-x-0 top-4 z-[40] flex justify-center px-3"
      >
        {({ toast }) => (
          <Toast
            toast={toast}
            className="pointer-events-auto w-fit max-w-[min(34rem,94vw)] rounded-xl border border-[#f3d5a3]/35 bg-[#0a1b2be6] px-4 py-3 text-[#f3fbff] shadow-[0_16px_44px_rgba(2,8,17,0.58)] backdrop-blur-md"
          >
            <ToastContent className="grid gap-1">
              <Text slot="title" className="text-[0.86rem] font-semibold tracking-[0.02em] text-[#fff5e8]">
                {toast.content.title}
              </Text>
              <Text slot="description" className="text-[0.78rem] leading-[1.35] text-[#d8e9f6]">
                {toast.content.description}
              </Text>
            </ToastContent>
          </Toast>
        )}
      </ToastRegion>
    </HomeClockShell>
  )
}

export default HomeClockTailwindPage
