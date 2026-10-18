import { useMemo, useState } from "react";
import { useGaps } from "../../lib/api";
import { Icon } from "../../ui/icons";
import { gapCoverage, gapSummaryLine, parseGaps } from "../gaps/gapModel";
import { type Profile, useScene } from "../scene/sceneStore";

const GAP_PROFILES = new Set(["stroller", "wheelchair", "older_adult_rest"]);

/**
 * The honesty promise on the empty assistant, with the real coverage numbers on request. The gap
 * layer is large (every path), so it loads only when asked. Every figure comes from /layers/gaps;
 * nothing here is a percentage the data does not give.
 */
export function CoverageCard() {
  const profile = useScene((s) => s.profile);
  const gapProfile: Profile = GAP_PROFILES.has(profile) ? profile : "wheelchair";
  const [asked, setAsked] = useState(false);
  const gaps = useGaps(gapProfile, asked);
  const { paths, open, demo, line } = useMemo(() => {
    const items = gaps.data ? parseGaps(gaps.data) : [];
    return { ...gapCoverage(items), line: gapSummaryLine(items, gapProfile) };
  }, [gaps.data, gapProfile]);
  const checked = paths - open;
  const pct = (v: number) => `${paths ? (100 * v) / paths : 0}%`;
  return (
    <section
      aria-labelledby="coverage-h"
      className="rounded-2xl border border-edge bg-raised p-4 text-sm"
    >
      <h2 id="coverage-h" className="m-0 flex items-center gap-2 text-sm font-semibold">
        <Icon name="check" className="size-4" />
        How answers are checked
      </h2>
      <p className="mt-1.5 mb-0 text-fg-soft">
        Routes come from mapped paths and checked facts only. Anything nobody has checked yet is
        marked <span className="font-medium text-lilac">Not checked yet</span> instead of guessed,
        and demo values are labelled as demo.
      </p>
      {!asked ? (
        <button
          type="button"
          onClick={() => setAsked(true)}
          className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-edge bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-fg/5"
        >
          See how much is checked
          <Icon name="chevron" className="size-3.5" />
        </button>
      ) : gaps.isPending ? (
        <p className="mt-3 mb-0 text-xs text-fg-soft" aria-live="polite">
          Counting paths…
        </p>
      ) : gaps.isError ? (
        <p className="mt-3 mb-0 text-xs text-fg-soft">Could not load the coverage numbers.</p>
      ) : paths === 0 ? (
        <p className="mt-3 mb-0 text-xs text-fg-soft">
          No path facts to count for this profile in the loaded data.
        </p>
      ) : (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className="m-0 font-medium text-fg" data-testid="coverage-line">
            {line}
          </p>
          <div
            role="img"
            aria-label={`${checked.toLocaleString("en-US")} paths checked, ${open.toLocaleString("en-US")} not checked yet`}
            className="flex h-2 overflow-hidden rounded-full bg-edge"
          >
            <span className="bg-ok" style={{ width: pct(checked) }} />
            <span
              className="bg-[repeating-linear-gradient(135deg,var(--c-lilac)_0_4px,transparent_4px_7px)]"
              style={{ width: pct(open) }}
            />
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[0.7rem] text-fg-soft tabular-nums">
            <li>
              <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-ok" />
              {checked.toLocaleString("en-US")} checked
            </li>
            <li>
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block size-2 rounded-full border border-dashed border-lilac"
              />
              {open.toLocaleString("en-US")} not checked yet
            </li>
            {demo > 0 && <li>{demo.toLocaleString("en-US")} on demo values</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
