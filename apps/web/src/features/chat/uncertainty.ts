const TEXT_KEYS = ["note", "text", "reason", "message", "description", "summary"];

const human = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Human-readable lines for uncertainty items (never raw ids or joined values). */
export function describeUncertainty(items: Record<string, string>[] | undefined): string[] {
  const out: string[] = [];
  for (const it of items ?? []) {
    const key = TEXT_KEYS.find((k) => it[k]);
    if (key) out.push(it[key] as string);
    else if (it.attribute) out.push(human(it.attribute));
  }
  return out;
}

/**
 * Exact duplicate lines collapsed into one with a count ("… on an unnamed footway (x12)"), in
 * first-seen order (gate §9.1 F6). Every distinct line is kept: nothing is hidden, only repeats.
 */
export function groupUncertainty(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].map(([l, n]) => (n > 1 ? `${l} (x${n})` : l));
}

/** Items that are things to know (closures, rest gaps, demo values…), not unchecked facts. */
const NOTE_ATTRIBUTES = new Set([
  "closure",
  "rest_gap",
  "entrance",
  "demo_values",
  "flood",
  "caveat",
]);

export interface BannerParts {
  heading: "Not checked yet" | "Please note";
  unchecked: string[];
  notes: string[];
}

/** Split uncertainty items into unchecked facts and notes, so the banner never mislabels a closure. */
export function bannerParts(items: Record<string, string>[] | undefined): BannerParts {
  const unchecked: string[] = [];
  const notes: string[] = [];
  for (const it of items ?? []) {
    const [line] = describeUncertainty([it]);
    if (!line) continue;
    (NOTE_ATTRIBUTES.has(it.attribute ?? "") ? notes : unchecked).push(line);
  }
  if (unchecked.length === 0 && notes.length === 0) notes.push("Some details are unconfirmed.");
  return { heading: unchecked.length > 0 ? "Not checked yet" : "Please note", unchecked, notes };
}
