import type React from "react"
import { SkySatelliteCanvas } from "./SkySatelliteCanvas"

interface HomeClockShellProps {
  ringFrameRef: React.RefObject<HTMLDivElement | null>
  conceptVars: React.CSSProperties
  children: React.ReactNode
}

export function HomeClockShell({ ringFrameRef, conceptVars, children }: HomeClockShellProps) {
  return (
    <main className="relative isolate grid h-screen w-screen place-items-center overflow-hidden bg-home-bg text-home-text animate-home-fade-in fx-home-shell">
      <SkySatelliteCanvas />
      <section className="relative z-[2] size-full overflow-hidden" aria-label="Sky ring 24 hour view">
        <div
          ref={ringFrameRef}
          style={conceptVars}
          className="absolute left-1/2 top-1/2 grid aspect-square w-[var(--ring-size)] -translate-x-1/2 -translate-y-1/2 place-items-center fx-home-ring-vars fx-home-ring-core"
        >
          {children}
        </div>
      </section>
    </main>
  )
}

export default HomeClockShell
