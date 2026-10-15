import { type RefObject, useEffect } from "react";

/** Focus the heading on open, return focus to the opener on close, and close on Escape. */
export function useOverlayA11y(
  heading: RefObject<HTMLElement | null>,
  onClose: () => void,
  skipRestore?: RefObject<boolean>,
) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    return () => {
      if (!skipRestore?.current && opener?.isConnected) opener.focus();
    };
  }, [heading, skipRestore]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Handled, so the demo bar's Esc shortcut does not also exit the demo.
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export const OVERLAY_CLASS =
  "absolute right-4 top-4 z-20 w-[330px] max-w-[calc(100%-2rem)] max-h-[calc(100%-6rem)] overflow-y-auto rounded-2xl border border-edge bg-surface p-4 text-fg shadow-xl focus-visible:outline-2 focus-visible:outline-accent";
