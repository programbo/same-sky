import { useEffect, useRef } from "react"

interface AmbientParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  twinklePhase: number
  twinkleSpeed: number
}

interface TrainParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  bornAtMs: number
  lifetimeMs: number
}

interface TrainConfig {
  angleRad: number
  speedPxPerSecond: number
  spacingPx: number
  leadY: number
  count: number
}

interface LeoSatelliteParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  glintPhase: number
  glintSpeed: number
  wobblePhase: number
  wobbleSpeed: number
  wobbleAmplitude: number
}

const TAU = Math.PI * 2
const AMBIENT_COUNT = 96
const FRAME_INTERVAL_MS = 1000 / 30
const TRAIN_INTERVAL_MIN_MS = 28_000
const TRAIN_INTERVAL_MAX_MS = 52_000
const LEO_MIN_COUNT = 42
const LEO_MAX_COUNT = 136
const LEO_AREA_PER_PARTICLE_PX = 15_000
const MAX_DPR = 2

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function wrap(value: number, min: number, max: number): number {
  const range = max - min
  if (range <= 0) {
    return min
  }

  let normalized = value
  while (normalized < min) {
    normalized += range
  }
  while (normalized > max) {
    normalized -= range
  }
  return normalized
}

function createAmbientParticles(count: number, width: number, height: number): AmbientParticle[] {
  return Array.from({ length: count }, () => {
    const speed = randomBetween(8, 18)
    const angleRad = randomBetween(-0.2, 0.24)
    return {
      x: randomBetween(0, width),
      y: randomBetween(0, height),
      vx: Math.cos(angleRad) * speed,
      vy: Math.sin(angleRad) * speed,
      size: randomBetween(0.9, 1.6),
      alpha: randomBetween(0.22, 0.52),
      twinklePhase: randomBetween(0, TAU),
      twinkleSpeed: randomBetween(0.7, 1.8),
    }
  })
}

function createTrainConfig(height: number): TrainConfig {
  return {
    angleRad: randomBetween(-0.14, 0.14),
    speedPxPerSecond: randomBetween(56, 72),
    spacingPx: randomBetween(8.2, 10.8),
    leadY: randomBetween(height * 0.2, height * 0.8),
    count: Math.round(randomBetween(18, 26)),
  }
}

function computeLeoCount(width: number, height: number): number {
  return Math.round(clamp((width * height) / LEO_AREA_PER_PARTICLE_PX, LEO_MIN_COUNT, LEO_MAX_COUNT))
}

function createLeoSatellites(count: number, width: number, height: number): LeoSatelliteParticle[] {
  const orbitalAngles = [-0.6, -0.42, -0.24, -0.06, 0.08, 0.22, 0.38, 0.54]
  return Array.from({ length: count }, () => {
    const bandAngle = orbitalAngles[Math.floor(Math.random() * orbitalAngles.length)] ?? 0
    const angleRad = bandAngle + randomBetween(-0.1, 0.1)
    const speed = randomBetween(22, 44)
    return {
      x: randomBetween(0, width),
      y: randomBetween(0, height),
      vx: Math.cos(angleRad) * speed,
      vy: Math.sin(angleRad) * speed,
      size: randomBetween(0.62, 1.22),
      alpha: randomBetween(0.08, 0.24),
      glintPhase: randomBetween(0, TAU),
      glintSpeed: randomBetween(1.1, 3.6),
      wobblePhase: randomBetween(0, TAU),
      wobbleSpeed: randomBetween(0.4, 1.2),
      wobbleAmplitude: randomBetween(2.2, 4.8),
    }
  })
}

function pushTrainParticles(
  particles: TrainParticle[],
  config: TrainConfig,
  width: number,
  nowMs: number,
): void {
  const pad = 34
  const directionX = Math.cos(config.angleRad)
  const directionY = Math.sin(config.angleRad)
  const leadX = -pad
  const lifetimeMs = ((width + pad * 2) / Math.max(8, directionX * config.speedPxPerSecond)) * 1000 + 900

  for (let index = 0; index < config.count; index += 1) {
    const offset = index * config.spacingPx
    const normalizedIndex = config.count <= 1 ? 0 : index / (config.count - 1)
    particles.push({
      x: leadX - directionX * offset,
      y: config.leadY - directionY * offset,
      vx: directionX * config.speedPxPerSecond,
      vy: directionY * config.speedPxPerSecond,
      size: 1.3 + (1 - normalizedIndex) * 0.8,
      alpha: 0.36 + (1 - normalizedIndex) * 0.5,
      bornAtMs: nowMs,
      lifetimeMs,
    })
  }
}

export function SkySatelliteCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext("2d")
    if (!context) {
      return
    }

    const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    const reduceMotion = motionQuery?.matches ?? false

    let width = 1
    let height = 1
    let devicePixelRatio = 1
    let ambient = createAmbientParticles(AMBIENT_COUNT, width, height)
    let leoSatellites = createLeoSatellites(computeLeoCount(width, height), width, height)
    const trains: TrainParticle[] = []

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      devicePixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      canvas.width = Math.max(1, Math.round(width * devicePixelRatio))
      canvas.height = Math.max(1, Math.round(height * devicePixelRatio))
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ambient = createAmbientParticles(AMBIENT_COUNT, width, height)
      leoSatellites = createLeoSatellites(computeLeoCount(width, height), width, height)
      trains.length = 0
    }

    resizeCanvas()

    const schedulePrimaryTrain = (fromMs: number): number =>
      fromMs + randomBetween(TRAIN_INTERVAL_MIN_MS, TRAIN_INTERVAL_MAX_MS)

    let nextPrimaryTrainAtMs = schedulePrimaryTrain(performance.now())
    let rafId = 0
    let lastFrameMs = performance.now()
    let accumulatorMs = 0
    let isHidden = document.visibilityState === "hidden"

    const maybeSpawnTrain = (nowMs: number) => {
      if (nowMs >= nextPrimaryTrainAtMs) {
        const primary = createTrainConfig(height)
        pushTrainParticles(trains, primary, width, nowMs)
        nextPrimaryTrainAtMs = schedulePrimaryTrain(nowMs)
      }
    }

    const drawFrame = (nowMs: number) => {
      context.clearRect(0, 0, width, height)

      const seconds = nowMs / 1000
      const wrapPadding = 20

      for (const particle of ambient) {
        const twinkle = 0.76 + 0.24 * Math.sin(seconds * particle.twinkleSpeed + particle.twinklePhase)
        const alpha = particle.alpha * twinkle
        context.fillStyle = `rgba(232, 244, 255, ${alpha.toFixed(3)})`
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, TAU)
        context.fill()
      }

      for (const particle of leoSatellites) {
        const rawGlint = 0.5 + 0.5 * Math.sin(seconds * particle.glintSpeed + particle.glintPhase)
        const glint = 0.2 + rawGlint * rawGlint * 0.8
        const alpha = particle.alpha * glint
        const glowAlpha = alpha * 0.24
        context.fillStyle = `rgba(200, 232, 255, ${glowAlpha.toFixed(3)})`
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * 1.8, 0, TAU)
        context.fill()

        context.fillStyle = `rgba(242, 250, 255, ${alpha.toFixed(3)})`
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, TAU)
        context.fill()
      }

      for (let index = trains.length - 1; index >= 0; index -= 1) {
        const particle = trains[index]
        if (!particle) {
          continue
        }

        const age = (nowMs - particle.bornAtMs) / particle.lifetimeMs
        if (age >= 1) {
          trains.splice(index, 1)
          continue
        }

        if (age < 0) {
          continue
        }

        const fadeIn = clamp(age / 0.12, 0, 1)
        const fadeOut = clamp((1 - age) / 0.22, 0, 1)
        const alpha = particle.alpha * Math.min(fadeIn, fadeOut)
        const glowAlpha = alpha * 0.26

        context.fillStyle = `rgba(209, 232, 255, ${glowAlpha.toFixed(3)})`
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * 2.1, 0, TAU)
        context.fill()

        context.fillStyle = `rgba(246, 251, 255, ${alpha.toFixed(3)})`
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, TAU)
        context.fill()
      }

      for (const particle of ambient) {
        particle.x += particle.vx * (FRAME_INTERVAL_MS / 1000)
        particle.y += particle.vy * (FRAME_INTERVAL_MS / 1000)

        if (particle.x > width + wrapPadding) {
          particle.x = -wrapPadding
          particle.y = wrap(particle.y + randomBetween(-height * 0.18, height * 0.18), -wrapPadding, height + wrapPadding)
        } else if (particle.x < -wrapPadding) {
          particle.x = width + wrapPadding
          particle.y = wrap(particle.y + randomBetween(-height * 0.18, height * 0.18), -wrapPadding, height + wrapPadding)
        }

        if (particle.y > height + wrapPadding) {
          particle.y = -wrapPadding
        } else if (particle.y < -wrapPadding) {
          particle.y = height + wrapPadding
        }
      }

      const deltaSeconds = FRAME_INTERVAL_MS / 1000
      for (const particle of leoSatellites) {
        const wobbleX = Math.sin(seconds * particle.wobbleSpeed + particle.wobblePhase) * particle.wobbleAmplitude
        const wobbleY = Math.cos(seconds * (particle.wobbleSpeed * 0.78) + particle.wobblePhase) * particle.wobbleAmplitude * 0.46
        particle.x += (particle.vx + wobbleX) * deltaSeconds
        particle.y += (particle.vy + wobbleY) * deltaSeconds

        if (particle.x > width + wrapPadding) {
          particle.x = -wrapPadding
          particle.y = wrap(particle.y + randomBetween(-height * 0.2, height * 0.2), -wrapPadding, height + wrapPadding)
        } else if (particle.x < -wrapPadding) {
          particle.x = width + wrapPadding
          particle.y = wrap(particle.y + randomBetween(-height * 0.2, height * 0.2), -wrapPadding, height + wrapPadding)
        }

        if (particle.y > height + wrapPadding) {
          particle.y = -wrapPadding
        } else if (particle.y < -wrapPadding) {
          particle.y = height + wrapPadding
        }
      }

      for (const particle of trains) {
        particle.x += particle.vx * deltaSeconds
        particle.y += particle.vy * deltaSeconds
      }
    }

    const drawStaticFrame = () => {
      context.clearRect(0, 0, width, height)
      for (const particle of ambient) {
        context.fillStyle = "rgba(232, 244, 255, 0.34)"
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, TAU)
        context.fill()
      }
      for (const particle of leoSatellites) {
        context.fillStyle = "rgba(240, 249, 255, 0.2)"
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * 0.9, 0, TAU)
        context.fill()
      }
    }

    if (reduceMotion) {
      drawStaticFrame()
      return
    }

    const onVisibilityChange = () => {
      isHidden = document.visibilityState === "hidden"
      if (!isHidden) {
        lastFrameMs = performance.now()
      }
    }

    const tick = (nowMs: number) => {
      rafId = window.requestAnimationFrame(tick)

      if (isHidden) {
        lastFrameMs = nowMs
        return
      }

      const elapsedMs = nowMs - lastFrameMs
      lastFrameMs = nowMs
      accumulatorMs += elapsedMs

      if (accumulatorMs < FRAME_INTERVAL_MS) {
        return
      }

      accumulatorMs %= FRAME_INTERVAL_MS
      maybeSpawnTrain(nowMs)
      drawFrame(nowMs)
    }

    let resizeObserver: ResizeObserver | null = null
    const onWindowResize = () => {
      resizeCanvas()
    }
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => {
        resizeCanvas()
      })
      resizeObserver.observe(canvas)
    } else {
      window.addEventListener("resize", onWindowResize)
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    rafId = window.requestAnimationFrame(tick)

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
      } else {
        window.removeEventListener("resize", onWindowResize)
      }
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-[1] h-full w-full pointer-events-none mix-blend-screen"
      aria-hidden="true"
    />
  )
}

export default SkySatelliteCanvas
