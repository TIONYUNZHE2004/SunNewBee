import { DEMO_CHIP, type JourneyCardContent } from "./cardContent";

/**
 * The provenance row every journey renderer shows under an event (3D card, List view, Mapbox
 * lite; AC-D14): the source line from `journeyCardContent`, the demo chip exactly when demo, and
 * the element id.
 */
export function CardSourceRow({
  content,
  elementId,
  className = "",
}: {
  content: JourneyCardContent;
  elementId?: string | null;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs text-fg-soft ${className}`}>
      <span data-testid="card-source">{content.source}</span>
      {content.demoChip && (
        <span className="rounded-md bg-[#fff0c9] px-1.5 py-px font-bold text-[#7a5a00]">
          {DEMO_CHIP}
        </span>
      )}
      {elementId && (
        <code data-testid="card-element" className="font-mono text-[11px]">
          {elementId}
        </code>
      )}
    </div>
  );
}
