import type { MarathonResult } from "./closureSimModel";

type Road = MarathonResult["course"]["roads"][number];

/** Unnamed stretches shorter than this (after merging neighbours) fold into one card line. */
export const SHORT_PATH_M = 50;

export interface CourseRow {
  /** The engine order of the row's first stretch (a stable key). */
  order: number;
  name: string;
  length_m: number;
  /** Engine rows merged into this one. */
  stretches: number;
}

export interface CourseRows {
  rows: CourseRow[];
  /** Short unnamed connecting paths, folded: their count and summed length. */
  short: { stretches: number; length_m: number };
}

const UNNAMED = /^unnamed path near (.+?) \(/;

/** The road a row belongs to: its name, or "unnamed paths near <landmark>" for unnamed stretches
 * (their direction, length and coordinates only tell stretches apart). */
export const roadKey = (name: string) => {
  const m = UNNAMED.exec(name);
  return m ? `unnamed paths near ${m[1]}` : name;
};

/**
 * The course card's rows (display only; the map keeps every engine stretch): short unnamed
 * stretches fold into one "short connecting paths" line, then consecutive rows of the same road
 * merge. Every engine metre lands in exactly one row or the short line, so the lengths still sum
 * to the engine's road lengths.
 */
export function courseRows(roads: readonly Road[]): CourseRows {
  const ordered = [...roads].sort((a, b) => a.order - b.order);
  // merge runs of the same road first, so many tiny pieces of one unnamed path are not all "short"
  const runs: (CourseRow & { unnamed: boolean })[] = [];
  for (const r of ordered) {
    const name = roadKey(r.name);
    const last = runs[runs.length - 1];
    if (last && last.name === name) {
      last.length_m += r.length_m;
      last.stretches += 1;
    } else
      runs.push({
        order: r.order,
        name,
        length_m: r.length_m,
        stretches: 1,
        unnamed: name !== r.name,
      });
  }
  const short = { stretches: 0, length_m: 0 };
  const rows: CourseRow[] = [];
  for (const { unnamed, ...run } of runs) {
    if (unnamed && run.length_m < SHORT_PATH_M) {
      short.stretches += run.stretches;
      short.length_m += run.length_m;
      continue;
    }
    const last = rows[rows.length - 1];
    if (last && last.name === run.name) {
      last.length_m += run.length_m;
      last.stretches += run.stretches;
    } else rows.push(run);
  }
  return { rows, short };
}
