import { splitLabel } from "./copy";

/**
 * "Hypothetical development · not an SDP project · 30 storeys · ~500 homes" (spec D3, AC-H3).
 * Anchored above the tower (`at`, stage CSS px, the label's bottom centre) when the 3D view
 * projects it; otherwise shown in place (the overlay stack), so it is never missing.
 */
export function HypotheticalLabel({
  text,
  at,
}: {
  text: string;
  at?: { x: number; y: number } | null;
}) {
  const { title, detail } = splitLabel(text);
  const style = at
    ? { left: `${at.x}px`, top: `${at.y}px`, transform: "translate(-50%, -100%)" }
    : undefined;
  return (
    <p
      role="note"
      aria-label={text}
      data-testid="devsim-hypothetical"
      data-devsim="hypotheticalLabel"
      style={style}
      className={`m-0 rounded-xl bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent shadow-[var(--c-shadow)] ${
        at ? "pointer-events-none absolute z-20 whitespace-nowrap" : "inline-block"
      }`}
    >
      <span className="block">{title}</span>
      {detail && <span className="block text-xs font-normal">{detail}</span>}
    </p>
  );
}
