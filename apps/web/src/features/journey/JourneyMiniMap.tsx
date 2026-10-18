import { useMemo } from "react";
import { statusStyle } from "../scene/styles";
import { KIND_COLOUR } from "./kindStyle";
import { miniMapLayout } from "./miniMap";
import type { SpanEval } from "./routePath";
import type { JourneyPlan } from "./timeline";

export const MINIMAP_W = 220;
const PAD = 10;

const SPAN: Record<SpanEval, { color: string; dash?: string }> = {
  PASS: { color: statusStyle("ok").color },
  UNKNOWN: { color: statusStyle("unknown").color, dash: "6 4" },
  FAIL: { color: statusStyle("blocked").color, dash: "2 3" },
};

/**
 * North-up route overview (spec §6.4): spans coloured by status, an event dot per plan event, and
 * the hero dot at `distanceM` (`data-testid="journey-minimap-hero"`; AC-D12 compares it with the
 * hero). Same route maths as the 3D hero (`routePath.ts`).
 */
export function JourneyMiniMap({ plan, distanceM }: { plan: JourneyPlan; distanceM: number }) {
  const mm = useMemo(() => miniMapLayout(plan, MINIMAP_W, PAD), [plan]);
  const [hx, hy] = mm.heroAt(distanceM);
  return (
    <figure
      data-testid="journey-minimap"
      className="glass m-0 w-[min(220px,40vw)] rounded-2xl p-2 text-fg"
    >
      <svg
        viewBox={`0 0 ${mm.width} ${mm.height.toFixed(2)}`}
        role="img"
        aria-label="Route overview"
        className="block h-auto w-full"
      >
        <rect width={mm.width} height={mm.height} rx="12" className="fill-raised" />
        {mm.spans.map((s, i) => (
          <polyline
            // biome-ignore lint/suspicious/noArrayIndexKey: spans are fixed per plan, in order
            key={i}
            data-eval={s.eval}
            points={s.points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")}
            fill="none"
            stroke={SPAN[s.eval].color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={SPAN[s.eval].dash}
          />
        ))}
        {mm.events.map((e, i) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: events are fixed per plan, in order
            key={i}
            cx={e.x}
            cy={e.y}
            r="3.5"
            fill="#fff"
            stroke={KIND_COLOUR[e.kind]}
            strokeWidth="2"
          />
        ))}
        <circle
          data-testid="journey-minimap-hero"
          data-m={distanceM.toFixed(2)}
          cx={hx}
          cy={hy}
          r="6"
          fill="#f5c518"
          stroke="#2c2a3a"
          strokeWidth="2"
        />
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 px-1 pt-1 text-[11px] text-fg-soft">
        <span>
          <i
            aria-hidden="true"
            className="mr-1 inline-block h-1 w-3.5 rounded-sm align-middle"
            style={{ background: SPAN.PASS.color }}
          />
          {statusStyle("ok").label}
        </span>
        <span>
          <i
            aria-hidden="true"
            className="mr-1 inline-block h-1 w-3.5 rounded-sm align-middle"
            style={{ background: SPAN.UNKNOWN.color }}
          />
          {statusStyle("unknown").label}
        </span>
      </figcaption>
    </figure>
  );
}
