import { skyRing, skyRingLayer } from "./homeClock.variants"

interface SkyRingLayersProps {
  wheelRotation: number
  isRingTransitioning: boolean
  displayedWheelGradient: string
}

export function SkyRingLayers({
  wheelRotation,
  isRingTransitioning,
  displayedWheelGradient,
}: SkyRingLayersProps) {
  const ringTransform = `rotate(${wheelRotation}deg)`

  return (
    <>
      <div
        className={skyRing({ switching: isRingTransitioning, glow: true })}
        style={{ transform: `${ringTransform} scale(1.075)` }}
        aria-hidden="true"
      >
        <div
          className={skyRingLayer({ tone: "glowCurrent" })}
          style={{ backgroundImage: displayedWheelGradient }}
          aria-hidden="true"
        />
      </div>

      <div className={skyRing({ switching: isRingTransitioning })} style={{ transform: ringTransform }}>
        <div className="absolute inset-0 z-0 overflow-hidden rounded-full fx-home-sky-stars" aria-hidden="true" />
        <div
          className={skyRingLayer({ tone: "current" })}
          style={{ backgroundImage: displayedWheelGradient }}
          aria-hidden="true"
        />
      </div>
    </>
  )
}

export default SkyRingLayers
