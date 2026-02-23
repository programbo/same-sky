import { skyRing, skyRingLayer } from "./homeClock.variants"

interface SkyRingLayersProps {
  wheelRotation: number
  isRingTransitioning: boolean
  isGradientTransitioning: boolean
  previousWheelGradient: string | null
  displayedWheelGradient: string
}

export function SkyRingLayers({
  wheelRotation,
  isRingTransitioning,
  isGradientTransitioning,
  previousWheelGradient,
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
        {previousWheelGradient ? (
          <div
            className={skyRingLayer({ tone: "glowPrevious", fadingOut: isGradientTransitioning })}
            style={{ backgroundImage: previousWheelGradient }}
            aria-hidden="true"
          />
        ) : null}
        <div
          className={skyRingLayer({ tone: "glowCurrent" })}
          style={{ backgroundImage: displayedWheelGradient }}
          aria-hidden="true"
        />
      </div>

      <div className={skyRing({ switching: isRingTransitioning })} style={{ transform: ringTransform }}>
        <div className="absolute inset-0 z-0 overflow-hidden rounded-full fx-home-sky-stars" aria-hidden="true" />
        {previousWheelGradient ? (
          <div
            className={skyRingLayer({ tone: "previous", fadingOut: isGradientTransitioning })}
            style={{ backgroundImage: previousWheelGradient }}
            aria-hidden="true"
          />
        ) : null}
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
