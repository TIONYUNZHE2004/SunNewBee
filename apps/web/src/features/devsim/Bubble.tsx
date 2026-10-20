import type { CSSProperties } from "react";
import { RouteTag } from "./RouteTag";
import type { BubbleTone } from "./types";

export interface BubbleView {
  n: number;
  text: string;
  tag?: string | null;
  tone: BubbleTone;
  speaker: { name: string; role?: string; colour: string };
}

/**
 * A Spotlight Resident's speech bubble (spec §4.3), with its ROUTE ENGINE tag beneath when it has
 * one. Positioned with its tail at `at` (stage CSS px) when the 3D view gives the speaker's head;
 * otherwise laid out in the overlay's fixed stack. Text is the plan's, verbatim.
 */
export function Bubble({ b, at }: { b: BubbleView; at?: { x: number; y: number } | null }) {
  const style: CSSProperties | undefined = at
    ? { left: `${at.x}px`, top: `${at.y}px`, transform: "translate(-50%, calc(-100% - 14px))" }
    : undefined;
  return (
    <figure
      data-testid="devsim-bubble"
      data-devsim="bubble"
      data-n={b.n}
      data-tone={b.tone}
      style={style}
      className={`m-0 flex max-w-[15rem] flex-col items-center ${
        at ? "pointer-events-none absolute z-20" : ""
      }`}
    >
      <blockquote
        className={`m-0 rounded-2xl border-2 bg-surface px-3 py-2 text-[15px] font-semibold leading-snug text-fg shadow-[var(--c-shadow)] ${
          b.tone === "neg" ? "border-rose" : "border-ok"
        }`}
      >
        <figcaption className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-fg">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: b.speaker.colour }}
          />
          {b.speaker.name}
        </figcaption>
        <p className="m-0">{b.text}</p>
      </blockquote>
      {b.tag && <RouteTag tag={b.tag} />}
    </figure>
  );
}
