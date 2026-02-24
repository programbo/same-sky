import { cn, tv } from "tailwind-variants"

export { cn }

export const skyRing = tv({
  base: "absolute inset-0 rounded-full transition-transform duration-[var(--home-rotation-duration)] ease-[var(--home-rotation-easing)] will-change-transform motion-reduce:transition-none fx-home-sky-mask",
  variants: {
    switching: {
      true: "duration-[var(--home-rotation-switch-duration)] ease-[var(--home-rotation-switch-easing)]",
    },
    glow: {
      true: "z-[1] pointer-events-none opacity-[0.88] shadow-none fx-home-sky-glow",
      false: "z-[2]",
    },
  },
})

export const skyRingLayer = tv({
  base: "absolute inset-0 z-[1] rounded-full",
  variants: {
    tone: {
      current: "opacity-90",
      glowCurrent: "opacity-[0.82]",
    },
  },
})

export const hourLayer = tv({
  base: "pointer-events-none absolute inset-0 z-[6] transition-transform duration-[var(--home-rotation-duration)] ease-[var(--home-rotation-easing)] motion-reduce:transition-none fx-home-hour-contrast-ring",
  variants: {
    switching: {
      true: "duration-[var(--home-rotation-switch-duration)] ease-[var(--home-rotation-switch-easing)]",
    },
  },
})

export const hourTick = tv({
  base: "absolute left-1/2 top-1/2 font-body text-[clamp(0.82rem,1.72vw,1.14rem)] font-medium leading-none tracking-[0.08em] text-[#f3fbff] [text-shadow:0_1px_2px_#020a14,0_0_10px_#020a14] max-[740px]:text-[0.78rem]",
  variants: {
    tone: {
      major: "opacity-100 [font-size:1.2em]",
      minor: "opacity-75",
    },
  },
})

export const centerCopy = tv({
  base: "animate-home-center-copy-in motion-reduce:animate-none",
})

export const orbitLabel = tv({
  base: "group absolute left-0 top-0 m-0 border-0 bg-transparent p-0 text-left pointer-events-auto cursor-default transition-[width,height] duration-[var(--home-rotation-switch-duration)] ease-[var(--home-rotation-switch-easing)] will-change-[transform,width,height] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-home-focus focus-visible:outline-offset-2",
  variants: {
    side: {
      left: "origin-right",
      right: "origin-left",
    },
    switching: {
      true: "duration-[var(--home-rotation-switch-duration)] ease-[var(--home-rotation-switch-easing)]",
    },
  },
})

export const labelSpoke = tv({
  base: "absolute left-0 top-0 block rounded-full bg-[#bedcf3db] [height:1.6px] [transform-origin:0_50%] [box-shadow:0_0_0.7px_rgba(255,255,255,0.78),0_0_9px_rgba(120,183,229,0.46)] transition-[background-color,height,box-shadow] duration-180 ease-out will-change-[transform,width] motion-reduce:transition-none",
  variants: {
    selected: {
      true: "bg-[#f7d9ace8] [height:2.2px] [box-shadow:0_0_0.8px_rgba(255,247,231,0.95),0_0_12px_rgba(230,179,107,0.54)]",
    },
  },
})

export const orbitChip = tv({
  base: "flex w-full min-h-0 flex-col items-stretch justify-start gap-y-[0.12rem] rounded-[16px] p-[0.2rem] text-left text-white backdrop-blur-[3px] transition-[transform,box-shadow,border-color] duration-150 ease-out max-[900px]:rounded-[13px] fx-home-orbit-chip",
  variants: {
    selected: {
      true: "fx-home-orbit-chip-selected",
    },
    local: {
      true: "border-dashed",
    },
  },
})

export const orbitEntityRow = tv({
  base: "grid min-h-10 w-full cursor-pointer grid-cols-[var(--orbit-icon-col)_minmax(0,1fr)] items-center gap-x-[var(--orbit-row-gap)] rounded-[10px] border border-transparent bg-transparent px-[var(--orbit-row-pad-x)] py-[0.34rem] text-left text-white transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:border-[#ffd89d99] hover:bg-[#ffd89d1f] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] focus-visible:outline-2 focus-visible:outline-home-focus focus-visible:outline-offset-1",
  variants: {
    selected: {
      true: "border-[#ffd89d99] bg-[#ffd89d1f] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
    },
  },
})
