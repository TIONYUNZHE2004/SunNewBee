import { useMemo, useRef } from "react";
import { type BuildingsLayer, useBuildings } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import type { AssetSpec } from "../scene/three/assets/manifest";
import { isFallback, useCityInfo } from "../scene/three/cityInfo";
import { hostOf, httpUrl } from "../scene/three/signs/signPlan";
import { InSlot } from "./mapSlots";
import { OVERLAY_CLASS, useOverlayA11y } from "./overlayA11y";

/** Where a building's drawn height comes from (`display_height_source`). */
export const HEIGHT_LABELS: Record<string, string> = {
  osm_height: "OSM height tag",
  osm_levels: "OSM building levels",
  archetype_storeys: "Typical storeys for this type",
  default: "Default estimate",
};

/** Display names of the archetypes (the model family a building is drawn with). */
const ARCHETYPE_LABELS: Record<string, string> = {
  generic: "Building (no specific type)",
  link_intermediate: "Link house",
  link_long: "Long link house",
  bungalow: "Bungalow",
  semi_d: "Semi-detached house",
  shop_office: "Shop office",
  factory: "Factory",
  school: "School",
  mosque: "Mosque",
  mall: "Mall",
  highrise: "High-rise",
};
const MATCH_LABELS: Record<string, string> = {
  traced_outline: "traced outline",
  building_name: "building name",
};

/**
 * A landmark's design-height line from its manifest entry: the first clause of `heightBasis`
 * (before ";") with its top-level commas shown as " · ", else "design height (N storeys)" from
 * `designStoreys`, else null.
 */
export function designHeightText(spec: AssetSpec | undefined): string | null {
  const basis = spec?.heightBasis?.split(";")[0]?.trim();
  if (basis) {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of basis) {
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    parts.push(cur.trim());
    return parts.filter(Boolean).join(" · ");
  }
  const n = spec?.designStoreys;
  return typeof n === "number" && n > 0 ? `design height (${n} storeys)` : null;
}

type Props = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function propsById(fc: unknown, id: string): Props | null {
  const list = (fc as { features?: { id?: unknown; properties?: Props | null }[] } | undefined)
    ?.features;
  for (const f of list ?? []) {
    const p = f?.properties;
    if (p && String(p.id ?? f.id) === id) return p;
  }
  return null;
}

interface Facts {
  title: string;
  lines: string[];
  link: string | null;
}

function buildingFacts(layer: BuildingsLayer, id: string, fallback: boolean): Facts | null {
  const p = propsById(layer.buildings, id);
  if (!p) return null;
  const arch = str(p.archetype);
  const type = (arch && ARCHETYPE_LABELS[arch]) ?? "Building (no specific type)";
  const asOf = str(layer.as_of);
  const height = HEIGHT_LABELS[str(p.display_height_source) ?? ""];
  return {
    title: "Building",
    lines: [
      `Building type: ${type}${fallback ? " (shown as a simple block)" : ""}`,
      asOf ? `Source: OSM · as of ${asOf}` : "Source: OSM",
      ...(height ? [`Height: ${height}`] : []),
    ],
    link: null,
  };
}

function landmarkFacts(layer: BuildingsLayer, p: Props, spec: AssetSpec | undefined): Facts | null {
  const name = str(p.name);
  if (!name) return null;
  const match = MATCH_LABELS[str(p.match) ?? ""];
  // A traced outline is drawn at the model's design height; a building-name match at its building's.
  const bid = str(p.building_id);
  const own = bid ? propsById(layer.buildings, bid) : null;
  const height =
    p.match === "traced_outline"
      ? designHeightText(spec)
      : own
        ? (HEIGHT_LABELS[str(own.display_height_source) ?? ""] ?? null)
        : null;
  const url = str(p.source_url);
  const label = str(p.source_label) ?? (url ? hostOf(url) : null);
  const asOf = str(p.as_of);
  return {
    title: name,
    lines: [
      match ? `Landmark · matched by ${match}` : "Landmark",
      ...(height ? [`Height: ${height}`] : []),
      ...(label ? [`Source: ${label}${asOf ? `, as of ${asOf}` : ""}`] : []),
    ],
    link: url ? httpUrl(url) : null,
  };
}

/** Map overlay card for a picked building or landmark: its type, where it came from, its height basis. */
export function BuildingCard() {
  const id = useScene((s) => s.selectedBuildingId);
  if (!id) return null;
  return <BuildingCardInner key={id} id={id} />;
}

function BuildingCardInner({ id }: { id: string }) {
  const selectBuilding = useScene((s) => s.selectBuilding);
  const q = useBuildings();
  const info = useCityInfo();
  const facts = useMemo(() => {
    const layer = q.data;
    if (!layer) return null;
    const lm = propsById(layer.landmarks, id);
    if (lm) {
      const model = str(lm.model);
      return landmarkFacts(layer, lm, model ? info.manifest?.assets[model] : undefined);
    }
    return buildingFacts(layer, id, isFallback(info, id));
  }, [q.data, id, info]);
  const head = useRef<HTMLHeadingElement>(null);
  useOverlayA11y(head, () => selectBuilding(null));
  if (!facts) return null;

  return (
    <InSlot name="card">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="building-card-h"
        className={OVERLAY_CLASS}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="building-card-h" ref={head} tabIndex={-1} className="text-lg font-semibold">
            {facts.title}
          </h2>
          <button
            type="button"
            aria-label="Close building details"
            onClick={() => selectBuilding(null)}
            className="min-h-11 min-w-11 shrink-0 rounded-lg border border-edge px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="mt-2 grid gap-1 text-sm text-fg-soft">
          {facts.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        {facts.link && (
          <a
            href={facts.link}
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
