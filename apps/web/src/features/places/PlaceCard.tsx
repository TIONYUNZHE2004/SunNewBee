import { useEffect, useMemo, useRef } from "react";
import { usePlace } from "../../lib/api";
import { useChatDraft } from "../chat/chatDraftStore";
import { useScene } from "../scene/sceneStore";
import { type ClaimRow, toPlaceView } from "./placeModel";

function Row({ r }: { r: ClaimRow }) {
  return (
    <li className="rounded-md border border-line bg-card px-3 py-2 text-sm">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{r.label}</span>
        <span className={r.isUnknown ? "italic text-ink-soft" : ""}>{r.value}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <span className="rounded border border-line px-1.5 py-0.5">
          <span aria-hidden="true">{r.icon} </span>
          {r.statusLabel}
        </span>
        {r.placeholder && (
          <span className="rounded border border-[#B7791F] bg-warn-tint px-1.5 py-0.5">
            placeholder
          </span>
        )}
        {r.source && <span className="text-ink-soft">Source: {r.source}</span>}
        {r.verifiedAt && <span className="text-ink-soft">checked {r.verifiedAt}</span>}
      </p>
    </li>
  );
}

/** Mobile: bottom sheet. Desktop: side panel. Non-modal dialog; Esc closes; focus returns. */
export function PlaceCard() {
  const id = useScene((s) => s.selectedPlaceId);
  if (!id) return null;
  return <PlaceCardInner key={id} id={id} />;
}

function PlaceCardInner({ id }: { id: string }) {
  const selectPlace = useScene((s) => s.selectPlace);
  const setDraft = useChatDraft((s) => s.setDraft);
  const q = usePlace(id);
  const view = useMemo(() => toPlaceView(q.data), [q.data]);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const asking = useRef(false);

  useEffect(() => {
    trigger.current = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      const el = trigger.current;
      if (!asking.current && el?.isConnected) el.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectPlace(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectPlace]);

  const ask = () => {
    if (!view) return;
    asking.current = true;
    setDraft(`Tell me about ${view.name}`);
    selectPlace(null);
    setTimeout(() => document.getElementById("chat-input")?.focus(), 0);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby="place-card-h"
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-y-auto rounded-t-2xl border border-line bg-paper p-4 shadow-xl focus-visible:outline-2 focus-visible:outline-brand lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:max-h-none lg:w-96 lg:rounded-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="place-card-h" className="text-xl font-semibold">
            {view?.name ?? "Place details"}
          </h2>
          {view && <p className="text-sm text-ink-soft">{view.typeLabel}</p>}
        </div>
        <button
          type="button"
          onClick={() => selectPlace(null)}
          className="min-h-11 shrink-0 rounded-lg border border-line bg-card px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand"
        >
          Close<span className="sr-only"> place details</span>
        </button>
      </div>

      <div className="mt-3">
        {q.isPending ? (
          <p role="status" className="text-ink-soft">
            Loading…
          </p>
        ) : q.isError || !view ? (
          <div role="alert" className="rounded-lg border border-line bg-danger-tint p-3 text-sm">
            <p className="font-medium">We could not load this place.</p>
            <p className="text-ink-soft">It may no longer exist, or the service is unavailable.</p>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="mt-2 min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Retry
            </button>
          </div>
        ) : view.rows.length === 0 ? (
          <p className="text-ink-soft">No facts recorded yet</p>
        ) : (
          <ul className="space-y-2" aria-label="Facts">
            {view.rows.map((r) => (
              <Row key={r.attr} r={r} />
            ))}
          </ul>
        )}
      </div>

      {view && (
        <button
          type="button"
          onClick={ask}
          className="mt-4 min-h-11 w-full rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Ask about this place
        </button>
      )}
    </div>
  );
}
