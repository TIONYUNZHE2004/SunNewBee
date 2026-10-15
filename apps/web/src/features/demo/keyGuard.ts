/** The slice of a keyboard event the guard reads (a real KeyboardEvent satisfies it). */
export interface KeyLike {
  key: string;
  defaultPrevented: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (sel: string) => unknown;
}

// Widgets that handle arrows, Space or Esc themselves.
const OWN_KEYS =
  '[role="tablist"],[role="tab"],[role="radiogroup"],[role="slider"],[role="listbox"],[role="menu"]';

/** True when a demo shortcut (Left, Right, Space, Esc) should act on this key event. */
export function shouldHandleKey(e: KeyLike): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as TargetLike | null;
  if (!t || typeof t.tagName !== "string") return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return false;
  if (t.closest?.(OWN_KEYS)) return false;
  // Space already activates a focused button or link.
  if (e.key === " " && /^(BUTTON|A)$/.test(t.tagName)) return false;
  return true;
}
