import { useMemo, useRef } from "react";
import { useBuildings } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import { hostOf, httpUrl } from "../scene/three/signs/signPlan";
import { InSlot } from "./mapSlots";
import { OVERLAY_CLASS, useOverlayA11y } from "./overlayA11y";

interface SignFacts {
  text: string;
  label: string;
  asOf: string;
  /** http(s) only; null when the feature's link is anything else (then no link is drawn). */
  url: string | null;
}

/** The selected sign's facts from the (already source-filtered) signage layer, or null. */
function findSign(signage: unknown, id: string): SignFacts | null {
  const list = (signage as { features?: { properties?: Record<string, unknown> }[] } | undefined)
    ?.features;
  for (const f of list ?? []) {
    const p = f?.properties;
    if (!p || p.id !== id) continue;
    const text = typeof p.text === "string" ? p.text.trim() : "";
    const asOf = typeof p.as_of === "string" ? p.as_of.trim() : "";
    const url = typeof p.source_url === "string" ? p.source_url.trim() : "";
    if (!text || !asOf || !url) return null;
    const label = typeof p.source_label === "string" && p.source_label.trim();
    return { text, asOf, url: httpUrl(url), label: label || hostOf(url) };
  }
  return null;
}

/** Map overlay card for a picked shop sign: its text, where it came from, and a link to the source. */
export function SignCard() {
  const id = useScene((s) => s.selectedSignId);
  if (!id) return null;
  return <SignCardInner key={id} id={id} />;
}

function SignCardInner({ id }: { id: string }) {
  const selectSign = useScene((s) => s.selectSign);
  const q = useBuildings();
  const sign = useMemo(() => findSign(q.data?.signage, id), [q.data, id]);
  const head = useRef<HTMLHeadingElement>(null);
  useOverlayA11y(head, () => selectSign(null));
  if (!sign) return null;

  return (
    <InSlot name="card">
      <div role="dialog" aria-modal="false" aria-labelledby="sign-card-h" className={OVERLAY_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sign-card-h" ref={head} tabIndex={-1} className="text-lg font-semibold">
              {sign.text}
            </h2>
            <p className="text-sm text-fg-soft">Shop sign</p>
          </div>
          <button
            type="button"
            aria-label="Close sign details"
            onClick={() => selectSign(null)}
            className="min-h-11 min-w-11 shrink-0 rounded-lg border border-edge px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="mt-3 text-sm text-fg-soft">
          Source: {sign.label}, as of {sign.asOf}
        </p>
        {sign.url && (
          <a
            href={sign.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Open source
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </InSlot>
  );
}
