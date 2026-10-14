import { optionLabel } from "../manage/attributeCatalogue";
import type { Citation } from "./chatReducer";

const PREFIX_NAMES: [string, string][] = [
  ["seg-", "Path segment"],
  ["evc-", "Evacuation candidate"],
];

export function elementName(id: string, names: Map<string, string>): string {
  return names.get(id) ?? PREFIX_NAMES.find(([p]) => id.startsWith(p))?.[1] ?? id;
}

export function citationLabel(c: Citation, names: Map<string, string>): string {
  return `${elementName(c.element_id, names)} · ${optionLabel(c.attribute)}`;
}

export interface ElementCitations {
  element_id: string;
  citations: Citation[];
}

export function groupByElement(cs: Citation[]): ElementCitations[] {
  const m = new Map<string, ElementCitations>();
  for (const c of cs) {
    const g = m.get(c.element_id) ?? { element_id: c.element_id, citations: [] };
    g.citations.push(c);
    m.set(c.element_id, g);
  }
  return [...m.values()];
}
