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
