import { useMemo, useRef } from "react";
import { usePlace } from "../../lib/api";
import { EvidencePhoto } from "../../lib/EvidencePhoto";
import { placeReach } from "../../lib/placeQuery";
import { Icon, type IconName } from "../../ui/icons";
import { StatusChip } from "../../ui/StatusChip";
import type { StatusKey } from "../../ui/status";
import { useChatDraft } from "../chat/chatDraftStore";
import { type ClaimRow, toPlaceView } from "../places/placeModel";
import { ClosureBanner, SourceBanner } from "../places/SourceBanner";
import { useScene } from "../scene/sceneStore";
import { OVERLAY_CLASS, useOverlayA11y } from "./overlayA11y";

function chipFor(r: ClaimRow): { status: StatusKey; label?: string } {
  if (r.placeholder) return { status: "demo" };
  if (r.status === "verified")
    return {
      status: "verified",
      label: r.verifiedAt ? `${r.statusLabel} ${r.verifiedAt}` : undefined,
    };
  if (r.status === "reported") return { status: "reported" };
  return { status: "unchecked" };
}

function iconFor(kind: string, typeLabel: string): IconName {
  const t = typeLabel.toLowerCase();
  if (kind === "evac_centre") return "pin";
  if (kind === "waste_point" || t.includes("recycl")) return "recycle";
  if (t.includes("park") || t.includes("playground")) return "walk";
  return "pin";
}

function Row({ r, placeName }: { r: ClaimRow; placeName: string }) {
  const chip = chipFor(r);
  return (
    <li className="rounded-lg border border-edge px-3 py-2 text-sm">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{r.label}</span>
        <span className={r.isUnknown ? "italic text-fg-soft" : ""}>{r.value}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <StatusChip {...chip} />
        {r.source && <span className="text-fg-soft">Source: {r.source}</span>}
      </p>
      <EvidencePhoto
        photoUrl={r.photoUrl}
        element={placeName}
        attributeLabel={r.label}
        source={r.source}
        checked={r.verifiedAt}
      />
    </li>
  );
}

/** Map overlay card for the selected place. Read-only: staff editing lives on the tickets screen. */
export function PlaceOverlay() {
  const id = useScene((s) => s.selectedPlaceId);
  if (!id) return null;
  return <PlaceOverlayInner key={id} id={id} />;
}

function PlaceOverlayInner({ id }: { id: string }) {
  const selectPlace = useScene((s) => s.selectPlace);
  const setDraft = useChatDraft((s) => s.setDraft);
  const scenarioId = useScene((s) => s.scenarioId);
  const profile = useScene((s) => s.profile);
  const q = usePlace(id, placeReach(id, scenarioId, profile));
  const view = useMemo(() => toPlaceView(q.data), [q.data]);
  const head = useRef<HTMLHeadingElement>(null);
  const asking = useRef(false);
  useOverlayA11y(head, () => selectPlace(null), asking);

  const ask = () => {
    if (!view) return;
    asking.current = true;
    setDraft(`Tell me about ${view.name}`);
    selectPlace(null);
    setTimeout(() => document.getElementById("chat-input")?.focus(), 0);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="place-overlay-h"
      className={OVERLAY_CLASS}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {view && (
            <span className="mt-0.5 text-accent">
              <Icon name={iconFor(view.kind, view.typeLabel)} />
            </span>
          )}
          <div>
            <h2 id="place-overlay-h" ref={head} tabIndex={-1} className="text-lg font-semibold">
              {view?.name ?? "Place details"}
            </h2>
            {view && <p className="text-sm text-fg-soft">{view.typeLabel}</p>}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close place details"
          onClick={() => selectPlace(null)}
          className="min-h-11 min-w-11 shrink-0 rounded-lg border border-edge px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <SourceBanner view={view} />
      <ClosureBanner view={view} />

      <div className="mt-3">
        {q.isPending ? (
          <p role="status" className="text-fg-soft">
            Loading…
          </p>
        ) : q.isError || !view ? (
          <div role="alert" className="rounded-lg border border-edge p-3 text-sm">
            <p className="font-medium">We could not load this place.</p>
            <p className="text-fg-soft">It may no longer exist, or the service is unavailable.</p>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="mt-2 min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent"
            >
              Retry
            </button>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Facts">
            {view.kind === "evac_centre" && (
              <li className="rounded-lg border border-edge px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Evacuation centre</span>
                  <StatusChip status={view.sourceTone === "official" ? "official" : "candidate"} />
                </p>
                <p className="mt-1 text-fg-soft">
                  {view.sourceTone === "official"
                    ? "Listed as an official relief centre. Opening depends on the authorities."
                    : "Found in map data. Not confirmed as an official relief centre."}
                </p>
              </li>
            )}
            {view.rows.map((r) => (
              <Row key={r.attr} r={r} placeName={view.name} />
            ))}
            {view.rows.length === 0 && view.kind !== "evac_centre" && (
              <li className="text-fg-soft">No facts recorded yet</li>
            )}
          </ul>
        )}
      </div>

      {view && (
        <button
          type="button"
          onClick={ask}
          className="mt-4 min-h-11 w-full rounded-lg bg-accent px-4 text-sm font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Ask about this place
        </button>
      )}
    </div>
  );
}
