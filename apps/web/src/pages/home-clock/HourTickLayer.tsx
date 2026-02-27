import type React from "react"
import { HOUR_MARKERS } from "../useHomeClockModel"
import { hourLayer, hourTick } from "./homeClock.variants"

interface HourTickLayerProps {
  wheelRotation: number
  isRingTransitioning: boolean
  areHourTicksVisible: boolean
}

export function HourTickLayer({ wheelRotation, isRingTransitioning, areHourTicksVisible }: HourTickLayerProps) {
  const markerText = (hour: number): React.ReactNode => {
    if (hour === 0) {
      return <span className="text-[1.55em] leading-none">🌙</span>
    }
    if (hour === 12) {
      return <span className="text-[1.55em] leading-none">☀️</span>
    }
    return String(hour).padStart(2, "0")
  }

  return (
    <div
      className={hourLayer({ switching: isRingTransitioning })}
      style={
        {
          transform: `rotate(${wheelRotation}deg)`,
          "--hour-layer-rotation": `${wheelRotation}deg`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {HOUR_MARKERS.map((hour) => {
        const angleDeg = (hour / 24) * 360
        const uprightCompensationDeg = angleDeg + wheelRotation
        const noonDistanceHours = Math.min(Math.abs(hour - 12), 24 - Math.abs(hour - 12))
        const introDelayMs = 110 + noonDistanceHours * 44
        return (
          <span
            key={hour}
            className={hourTick({ tone: hour % 3 === 0 ? "major" : "minor" })}
            style={{
              transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
            }}
          >
            <span
              className="block will-change-[transform,opacity,filter]"
              style={{
                transform: areHourTicksVisible
                  ? "translateY(calc(-1 * var(--hour-tick-radius))) scale(1)"
                  : "translateY(calc(-1 * (var(--ring-core-size) * 0.48))) scale(0.86)",
                opacity: areHourTicksVisible ? 1 : 0,
                filter: areHourTicksVisible ? "blur(0px)" : "blur(6px)",
                transitionProperty: "transform, opacity, filter",
                transitionDuration: "920ms",
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                transitionDelay: areHourTicksVisible ? `${introDelayMs}ms` : "0ms",
              }}
            >
              <span className="block" style={{ transform: `rotate(${-uprightCompensationDeg}deg)` }}>
                {markerText(hour)}
              </span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

export default HourTickLayer
