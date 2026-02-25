import type { CSSProperties } from "react"
import { skyRing, skyRingLayer } from "./homeClock.variants"

interface SkyRingLayersProps {
  wheelRotation: number
  isRingTransitioning: boolean
  displayedWheelGradient: string
  displayedNightMaskGradient: string
}

export function SkyRingLayers({
  wheelRotation,
  isRingTransitioning,
  displayedWheelGradient,
  displayedNightMaskGradient,
}: SkyRingLayersProps) {
  const ringTransform = `rotate(${wheelRotation}deg)`
  const glowExpandPct = 18
  const glowInset = `-${glowExpandPct}%`
  const originalOuterEdgePctInGlowCanvas = (50 / (50 + glowExpandPct)) * 100
  const daylightAmbientClassName =
    "absolute inset-0 z-[0] rounded-full pointer-events-none transition-transform ease-[var(--home-rotation-easing)] will-change-transform motion-reduce:transition-none fx-home-daylight-ambient-mask fx-home-daylight-ambient"
  const auroraClassName =
    "absolute inset-0 z-[1] rounded-full pointer-events-none transition-transform ease-[var(--home-rotation-easing)] will-change-transform motion-reduce:transition-none"
  const auroraMaskStyle: CSSProperties = {
    WebkitMaskImage: displayedNightMaskGradient,
    maskImage: displayedNightMaskGradient,
    maskMode: "luminance",
  }

  const maskImage = `radial-gradient(circle closest-side, transparent 0 ${originalOuterEdgePctInGlowCanvas.toFixed(3)}%, rgba(0, 0, 0, 0.9) ${(originalOuterEdgePctInGlowCanvas + 0.8).toFixed(3)}%, rgba(0, 0, 0, 0.62) ${(originalOuterEdgePctInGlowCanvas + 10).toFixed(3)}%, rgba(0, 0, 0, 0.18) ${(originalOuterEdgePctInGlowCanvas + 22).toFixed(3)}%, transparent ${(originalOuterEdgePctInGlowCanvas + 33).toFixed(3)}%)`
  const auroraOutsideOnlyMaskStyle: CSSProperties = {
    WebkitMaskImage: maskImage,
    maskImage,
  }
  const auroraGlowStyle: CSSProperties = {
    backgroundColor: "#00ffff",
    opacity: 0.02,
    mixBlendMode: "screen",
    transform: "scale(1)",
    transformOrigin: "50% 50%",
    filter:
      "blur(clamp(22px, calc(var(--ring-size) * 0.15), 152px)) brightness(1.35) saturate(1.28) drop-shadow(0 0 clamp(62px, calc(var(--ring-size) * 0.125), 150px) rgba(255, 0, 0, 0.86)) drop-shadow(0 0 clamp(106px, calc(var(--ring-size) * 0.215), 250px) rgba(255, 0, 0, 0.52))",
    ...auroraMaskStyle,
  }

  return (
    <>
      <div
        className={daylightAmbientClassName}
        style={{
          transform: ringTransform,
          transitionDuration: isRingTransitioning
            ? "calc(var(--home-rotation-switch-duration) * 5)"
            : "var(--home-rotation-duration)",
        }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 rounded-full fx-home-daylight-ambient-fill"
          style={{ backgroundImage: displayedWheelGradient }}
          aria-hidden="true"
        />
      </div>

      <div
        className={auroraClassName}
        style={{
          transform: ringTransform,
          transitionDuration: isRingTransitioning
            ? "calc(var(--home-rotation-switch-duration) * 5)"
            : "var(--home-rotation-duration)",
        }}
        aria-hidden="true"
      >
        <div
          className="absolute rounded-full"
          style={{ inset: glowInset, ...auroraOutsideOnlyMaskStyle }}
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-full" style={auroraGlowStyle} aria-hidden="true" />
        </div>
      </div>

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
