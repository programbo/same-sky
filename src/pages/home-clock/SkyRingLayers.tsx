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
      <div className={skyRing({ switching: isRingTransitioning })} style={{ transform: ringTransform }}>
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
