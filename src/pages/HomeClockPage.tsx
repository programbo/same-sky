import type React from "react"
import NumberFlow from "@number-flow/react"
import "../home-clock.css"
import "../with-css.css"
import {
  formatRelativeOffsetDirectionLabel,
  HOUR_MARKERS,
  HOUR_TREND,
  MINUTE_TREND,
  NUMBER_FLOW_PLUGINS,
  useHomeClockModel,
} from "./useHomeClockModel"

export function HomeClockPage() {
  const model = useHomeClockModel()

  return (
    <main className="with-css-root home-shell home-shell--zenith">
      <section className="home-ring-stage" aria-label="Sky ring 24 hour view">
        <div className="home-ring-frame" ref={model.ringFrameRef} style={model.conceptVars}>
          <div
            className={`home-sky-ring home-sky-ring-glow ${model.isRingTransitioning ? "is-switching" : ""}`}
            style={{ transform: `rotate(${model.wheelRotation}deg) scale(1.03)` }}
            aria-hidden="true"
          >
            <div
              className="home-sky-ring-layer is-current"
              style={{ backgroundImage: model.displayedWheelGradient }}
              aria-hidden="true"
            />
          </div>

          <div
            className={`home-sky-ring ${model.isRingTransitioning ? "is-switching" : ""}`}
            style={{ transform: `rotate(${model.wheelRotation}deg)` }}
          >
            <div className="home-sky-ring-stars" aria-hidden="true" />
            <div
              className="home-sky-ring-layer is-current"
              style={{ backgroundImage: model.displayedWheelGradient }}
              aria-hidden="true"
            />
          </div>

          <div className="home-center-readout">
            <div key={model.centerCopyTransitionKey} className="home-center-copy">
              <p className="home-center-label">{model.selectedCopyLabel}</p>
              <p className="home-center-time">
                {model.centerTimeParts ? (
                  <>
                    <NumberFlow
                      className="home-center-time-flow"
                      value={model.centerTimeParts.hour}
                      animated={model.shouldAnimateHour}
                      plugins={NUMBER_FLOW_PLUGINS}
                      trend={HOUR_TREND}
                      format={{ minimumIntegerDigits: 2, useGrouping: false }}
                    />
                    <span className="home-center-time-separator">:</span>
                    <NumberFlow
                      className="home-center-time-flow"
                      value={model.centerTimeParts.minute}
                      animated={model.shouldAnimateMinute}
                      plugins={NUMBER_FLOW_PLUGINS}
                      trend={MINUTE_TREND}
                      digits={{ 1: { max: 5 } }}
                      format={{ minimumIntegerDigits: 2, useGrouping: false }}
                    />
                  </>
                ) : (
                  model.displayCenterTime.slice(0, 5)
                )}
              </p>
              <p className="home-center-meta-label">UTC offset</p>
              <p className="home-center-meta">
                <span>UTC{model.centerUtcOffsetParts.sign}</span>
                <NumberFlow
                  className="home-center-meta-flow"
                  value={model.centerUtcOffsetParts.hours}
                  animated={model.shouldAnimateUtcHours}
                  plugins={NUMBER_FLOW_PLUGINS}
                  format={{ minimumIntegerDigits: 1, useGrouping: false }}
                />
                {model.centerUtcOffsetParts.minutes > 0 ? (
                  <>
                    <span>:</span>
                    <NumberFlow
                      className="home-center-meta-flow"
                      value={model.centerUtcOffsetParts.minutes}
                      animated={model.shouldAnimateUtcMinutes}
                      plugins={NUMBER_FLOW_PLUGINS}
                      trend={MINUTE_TREND}
                      digits={{ 1: { max: 5 } }}
                      format={{ minimumIntegerDigits: 2, useGrouping: false }}
                    />
                  </>
                ) : null}
              </p>
            </div>
            {model.ringError ? (
              <p className="home-ring-error" role="alert">
                {model.ringError}
              </p>
            ) : null}
          </div>

          <div
            className={`home-hour-layer ${model.isRingTransitioning ? "is-switching" : ""}`}
            style={
              {
                transform: `rotate(${model.wheelRotation}deg)`,
                "--hour-layer-rotation": `${model.wheelRotation}deg`,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            {HOUR_MARKERS.map((hour) => {
              const angleDeg = (hour / 24) * 360
              const uprightCompensationDeg = angleDeg + model.wheelRotation
              return (
                <span
                  key={hour}
                  className={`home-hour-tick ${hour % 3 === 0 ? "is-major" : "is-minor"}`}
                  style={{
                    transform: `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(calc(-1 * var(--hour-tick-radius))) rotate(${-uprightCompensationDeg}deg)`,
                  }}
                >
                  {String(hour).padStart(2, "0")}
                </span>
              )
            })}
          </div>

          <div className="home-label-orbit" role="listbox" aria-label="Saved locations by 24 hour offset">
            <div className="home-label-leaders" aria-hidden="true">
              {model.orbitLabelLayout.map((label) => {
                const dx = label.spokeEndX - label.anchorX
                const dy = label.spokeEndY - label.anchorY
                const length = Math.hypot(dx, dy)
                const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
                return (
                  <span
                    key={`${label.id}-leader`}
                    className={`home-label-spoke ${label.isSelected ? "is-selected" : ""}`}
                    style={{
                      width: `${length}px`,
                      transform: `translate(${label.anchorX}px, ${label.anchorY}px) rotate(${angleDeg}deg)`,
                    }}
                  />
                )
              })}
            </div>

            {model.orbitLabelLayout.map((label) => {
              const primarySelectionId = label.members.find((member) => member.isSelected)?.id ?? label.members[0]?.id
              const offsetSuffix = label.isSelected ? "" : formatRelativeOffsetDirectionLabel(label.relativeOffsetMinutes)
              const timeWithOffset = offsetSuffix ? `${label.time} ${offsetSuffix}` : label.time
              return (
                <div
                  key={label.id}
                  role="option"
                  aria-selected={label.isSelected}
                  aria-label={`${timeWithOffset} ${label.timezoneMeta}`}
                  className={`home-orbit-label ${model.isRingTransitioning ? "is-switching" : ""} ${label.side === "left" ? "side-left" : "side-right"} ${
                    label.isSelected ? "is-selected" : ""
                  } ${label.isLocal ? "is-local" : ""}`}
                  style={{
                    transform: `translate(${label.x}px, ${label.y}px)`,
                    width: `${label.width}px`,
                    zIndex: label.isSelected ? 18 : 10,
                  }}
                  title={`${timeWithOffset} ${label.timezoneMeta}`}
                  tabIndex={0}
                  onClick={() => {
                    if (primarySelectionId) {
                      model.setSelectedId(primarySelectionId)
                    }
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && primarySelectionId) {
                      event.preventDefault()
                      model.setSelectedId(primarySelectionId)
                    }
                  }}
                >
                  <span
                    className="home-orbit-chip"
                    style={{ "--orbit-accent": label.skyColorHex } as React.CSSProperties}
                  >
                    <em className="home-orbit-chip-entities">
                      {label.members.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          className={`home-orbit-entity-row ${member.isSelected ? "is-selected" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            model.setSelectedId(member.id)
                          }}
                          title={`${member.label} · ${member.time} (${member.relativeLabel})`}
                        >
                          <span className="home-orbit-entity-emoji" aria-hidden="true">
                            {member.leadingEmoji}
                          </span>
                          <span className="home-orbit-entity-name">{member.label}</span>
                        </button>
                      ))}
                    </em>
                    <strong className="home-orbit-chip-meta">
                      <span className="home-orbit-chip-time">{label.time}</span>
                      {!label.isSelected ? <span className="home-orbit-chip-offset">{offsetSuffix}</span> : null}
                    </strong>
                  </span>
                </div>
              )
            })}
          </div>

          {model.orbitLabels.length === 0 ? (
            <p className="home-empty-note">No saved locations yet. The ring follows your current timezone.</p>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default HomeClockPage
