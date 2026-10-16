import { type ReactNode, useCallback } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

export type SlotName = "route" | "flood" | "hint" | "card" | "notes";

const useSlots = create<{
  els: Partial<Record<SlotName, HTMLElement>>;
  set: (n: SlotName, el: HTMLElement | null) => void;
}>((set) => ({
  els: {},
  set: (n, el) =>
    set((s) => {
      const els = { ...s.els };
      if (el) els[n] = el;
      else delete els[n];
      return { els };
    }),
}));

/** Renders into a named slot of the map's overlay stacks; inline when no stack is mounted. */
export function InSlot({ name, children }: { name: SlotName; children: ReactNode }) {
  const el = useSlots((s) => s.els[name]);
  return el ? createPortal(children, el) : <>{children}</>;
}

function Slot({ name, className }: { name: SlotName; className: string }) {
  const set = useSlots((s) => s.set);
  const ref = useCallback((el: HTMLDivElement | null) => set(name, el), [set, name]);
  return (
    <div
      ref={ref}
      data-slot={name}
      className={`${className} pointer-events-none empty:hidden *:pointer-events-auto`}
    />
  );
}

/** Top of the visible map: route tag, flood banner, camera hint, stacked so they never overlap. */
export function TopStack() {
  return (
    <div
      data-testid="top-stack"
      className="pointer-events-none absolute left-4 right-[calc(var(--panel-w,0px)+1rem)] top-4 z-20 flex flex-col gap-2"
    >
      <Slot name="route" className="self-start" />
      <Slot name="flood" className="self-center max-w-full" />
      <Slot name="hint" className="self-center max-w-full" />
    </div>
  );
}

/** Bottom-left: the place or path card, then map notes beneath it; sits above the phone sheet. */
export function BottomStack() {
  return (
    <div
      data-testid="bottom-stack"
      className="pointer-events-none absolute bottom-[calc(var(--sheet-h,0px)+2rem)] left-4 z-20 flex max-h-[max(0px,calc(100%-var(--sheet-h,0px)-6rem))] max-w-[calc(100%-2rem)] flex-col items-start gap-2"
    >
      <Slot name="card" className="min-h-0 max-w-full overflow-y-auto" />
      <Slot name="notes" className="flex flex-col gap-2" />
    </div>
  );
}
