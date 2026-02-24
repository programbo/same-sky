import NumberFlow from "@number-flow/react"
import { HOUR_TREND, MINUTE_TREND, NUMBER_FLOW_PLUGINS } from "../useHomeClockModel"
import { cn, centerCopy } from "./homeClock.variants"

interface CenterReadoutProps {
  centerCopyTransitionKey: number
  selectedCopyLabel: string
  centerTimeParts: {
    hour: number
    minute: number
  } | null
  displayCenterTime: string
  centerUtcOffsetParts: {
    sign: "+" | "-"
    hours: number
    minutes: number
  }
  shouldAnimateHour: boolean
  shouldAnimateMinute: boolean
  shouldAnimateUtcHours: boolean
  shouldAnimateUtcMinutes: boolean
  ringError: string | null
}

export function CenterReadout({
  centerCopyTransitionKey,
  selectedCopyLabel,
  centerTimeParts,
  displayCenterTime,
  centerUtcOffsetParts,
  shouldAnimateHour,
  shouldAnimateMinute,
  shouldAnimateUtcHours,
  shouldAnimateUtcMinutes,
  ringError,
}: CenterReadoutProps) {
  const selectedCopyLabelLength = selectedCopyLabel.trim().length
  const isLongSelectedCopyLabel = selectedCopyLabelLength >= 22
  const isVeryLongSelectedCopyLabel = selectedCopyLabelLength >= 30

  return (
    <div className="relative z-[5] grid aspect-square w-[var(--ring-core-size)] min-w-[220px] place-content-center rounded-full border border-sky-200/20 p-4 text-center backdrop-blur-sm max-[900px]:min-w-[204px] max-[900px]:p-[0.9rem] fx-home-center-glass">
      <div key={centerCopyTransitionKey} className={centerCopy()}>
        <p
          className={cn(
            "m-0 mx-auto max-w-full px-[0.44rem] font-body text-[clamp(0.88rem,1.8vw,1.3rem)] font-light leading-[1.05] tracking-[0.2em] text-[#d6e7f4] uppercase max-[740px]:text-[clamp(0.78rem,3.7vw,1.04rem)]",
            isLongSelectedCopyLabel &&
              "px-[0.72rem] text-[clamp(0.78rem,1.52vw,1.06rem)] tracking-[0.14em] max-[740px]:text-[clamp(0.72rem,3.2vw,0.9rem)]",
            isVeryLongSelectedCopyLabel &&
              "px-[0.86rem] text-[clamp(0.72rem,1.34vw,0.92rem)] tracking-[0.11em] max-[740px]:text-[clamp(0.68rem,2.9vw,0.82rem)]",
          )}
        >
          {selectedCopyLabel}
        </p>
        <p className="m-[0.92rem_0_0.9rem] inline-flex min-h-[1em] items-baseline font-display text-[clamp(2.8rem,7.84vw,5.46rem)] font-bold leading-[0.95] text-[#f3faff] [font-variant-numeric:tabular-nums] [text-shadow:0_0_24px_rgba(255,255,255,0.2)] max-[740px]:text-[clamp(2.45rem,13vw,4.06rem)]">
          {centerTimeParts ? (
            <>
              <NumberFlow
                className="inline-block w-[2ch] min-w-[2ch] text-center leading-none [font-variant-numeric:tabular-nums]"
                value={centerTimeParts.hour}
                animated={shouldAnimateHour}
                plugins={NUMBER_FLOW_PLUGINS}
                trend={HOUR_TREND}
                format={{ minimumIntegerDigits: 2, useGrouping: false }}
              />
              <span className="mx-[0.04ch] inline-flex min-w-[0.4ch] items-center justify-center leading-none opacity-[0.86]">:</span>
              <NumberFlow
                className="inline-block w-[2ch] min-w-[2ch] text-center leading-none [font-variant-numeric:tabular-nums]"
                value={centerTimeParts.minute}
                animated={shouldAnimateMinute}
                plugins={NUMBER_FLOW_PLUGINS}
                trend={MINUTE_TREND}
                digits={{ 1: { max: 5 } }}
                format={{ minimumIntegerDigits: 2, useGrouping: false }}
              />
            </>
          ) : (
            displayCenterTime.slice(0, 5)
          )}
        </p>
        <p className="m-0 font-body text-[clamp(0.64rem,1.1vw,0.8rem)] font-light leading-[1.1] tracking-[0.16em] text-[#93aec2] uppercase">
          UTC offset
        </p>
        <p className="m-[0.18rem_0_0] inline-flex items-baseline gap-[0.02em] text-[clamp(0.86rem,1.5vw,1.12rem)] tracking-[0.09em] text-[#bbd1e0] [font-variant-numeric:tabular-nums] max-[740px]:text-[0.84rem]">
          <span>UTC{centerUtcOffsetParts.sign}</span>
          <NumberFlow
            className="min-w-[1ch] [font-variant-numeric:tabular-nums]"
            value={centerUtcOffsetParts.hours}
            animated={shouldAnimateUtcHours}
            plugins={NUMBER_FLOW_PLUGINS}
            format={{ minimumIntegerDigits: 1, useGrouping: false }}
          />
          {centerUtcOffsetParts.minutes > 0 ? (
            <>
              <span>:</span>
              <NumberFlow
                className="min-w-[1ch] [font-variant-numeric:tabular-nums]"
                value={centerUtcOffsetParts.minutes}
                animated={shouldAnimateUtcMinutes}
                plugins={NUMBER_FLOW_PLUGINS}
                trend={MINUTE_TREND}
                digits={{ 1: { max: 5 } }}
                format={{ minimumIntegerDigits: 2, useGrouping: false }}
              />
            </>
          ) : null}
        </p>
      </div>
      {ringError ? <p className="m-[0.56rem_0_0] text-[0.74rem] text-[#ffd7c8]" role="alert">{ringError}</p> : null}
    </div>
  )
}

export default CenterReadout
