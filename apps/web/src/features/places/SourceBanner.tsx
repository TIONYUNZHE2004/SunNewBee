import { MBSA_CONTACT_URL } from "../../lib/evidence";
import type { PlaceView } from "./placeModel";

/** Prominent source label for evacuation centres and waste points. Text, not colour alone. */
export function SourceBanner({ view }: { view: PlaceView | null }) {
  if (!view?.sourceLabel) return null;
  const candidate = view.sourceTone === "candidate";
  return (
    <div
      className={`mt-3 rounded-lg border px-3 py-2 text-sm ${candidate ? "border-[#B7791F] bg-warn-tint" : "border-line bg-card"}`}
    >
      <p className="font-semibold">
        <span className="sr-only">Source: </span>
        {view.sourceLabel}
      </p>
      {view.reachability && (
        <p className="mt-1">
          <span className="font-medium">Route from the demo start point: </span>
          {view.reachability.label}
          {view.reachability.disclaimer && (
            <span className="block text-ink-soft">{view.reachability.disclaimer}</span>
          )}
        </p>
      )}
      {view.collectionDay && (
        <p className="mt-1">
          {view.collectionDay}.{" "}
          <a
            href={MBSA_CONTACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Contact MBSA<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      )}
    </div>
  );
}
