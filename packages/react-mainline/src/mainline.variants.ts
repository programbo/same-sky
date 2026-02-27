import { twMerge } from "tailwind-merge";
import { tv } from "tailwind-variants";

export const cx = (...classes: Array<string | undefined | null | false>) => {
  return twMerge(classes.filter(Boolean).join(" "));
};

export const mainlineChrome = tv({
  slots: {
    trigger:
      "fixed right-4 top-4 z-[28] inline-flex items-center gap-2 rounded-full border border-[#8ab4cc55] bg-[#0d1a29dd] px-3 py-1.5 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[#e8f5ff] shadow-[0_8px_20px_#0008] backdrop-blur-md hover:border-[#ffd89d99] hover:text-white focus-visible:outline-2 focus-visible:outline-[#ffd89d]",
    overlay: "fixed inset-0 z-[40] bg-[#03070dbd] backdrop-blur-md",
    modal:
      "fixed left-1/2 top-[10svh] w-[min(40rem,calc(100vw-1.4rem))] -translate-x-1/2 rounded-[20px] border border-[#9bc5dd52] bg-[#0a1624eb] p-0 shadow-[0_28px_60px_#000a]",
    dialog: "flex max-h-[74svh] min-h-[18rem] flex-col overflow-hidden",
    header: "border-b border-[#8ab4cc3d] px-4 pb-3 pt-4",
    title:
      "m-0 text-[0.88rem] font-semibold uppercase tracking-[0.08em] text-[#d8ebf8]",
    subtitle: "mt-1 text-[0.76rem] text-[#a9c4d6]",
    searchField:
      "mt-3 flex items-center gap-2 rounded-xl border border-[#86b6d24a] bg-[#0d2134bf] px-3 py-2",
    input:
      "w-full border-0 bg-transparent font-body text-[0.96rem] text-[#f5fbff] outline-none placeholder:text-[#8fb2c7]",
    inputSubmit:
      "rounded-lg border border-[#88b6d05a] bg-[#14324a] px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[#d6edf8]",
    list: "min-h-0 flex-1 overflow-y-auto p-2",
    emptyState: "px-4 py-6 text-center text-[0.84rem] text-[#9db6c8]",
    footerHint:
      "border-t border-[#8ab4cc2f] px-4 py-2 text-[0.68rem] tracking-[0.04em] text-[#8faac0]",
  },
});

export const commandItem = tv({
  base: "mb-1.5 flex w-full items-start justify-between gap-3 rounded-xl border border-transparent bg-[#0e2235b8] px-3 py-2 text-left outline-none transition-colors hover:bg-[#132c44] data-selected:border-[#ffd89d80] data-selected:bg-[#1a3347] data-focus-visible:outline-2 data-focus-visible:outline-[#ffd89d]",
  variants: {
    disabled: {
      true: "cursor-not-allowed opacity-50",
      false: "cursor-pointer",
    },
  },
});
