import type React from "react"
import { HOUR_MARKERS } from "../useHomeClockModel"
import { hourLayer, hourTick } from "./homeClock.variants"

interface HourTickLayerProps {
  wheelRotation: number
  isRingTransitioning: boolean
}

export function HourTickLayer({ wheelRotation, isRingTransitioning }: HourTickLayerProps) {
  const markerText = (hour: number): string => {
    if (hour === 0) {
      return "🌙"
    }
    if (hour === 12) {
      return "☀️"
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
        return (
          <span
            key={hour}
            className={hourTick({ tone: hour % 3 === 0 ? "major" : "minor" })}
            style={{
              transform: `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(calc(-1 * var(--hour-tick-radius))) rotate(${-uprightCompensationDeg}deg)`,
            }}
          >
            {markerText(hour)}
          </span>
        )
      })}
    </div>
  )
}

export default HourTickLayer
