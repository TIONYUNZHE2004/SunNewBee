export type Tone = "cream" | "ok" | "amber" | "lilac" | "muted" | "rose" | "flood" | "peach";
export type StatusKey =
  | "verified"
  | "reported"
  | "unchecked"
  | "unknown"
  | "clear"
  | "blocked"
  | "likely"
  | "possibly"
  | "candidate"
  | "official"
  | "gap"
  | "rejected"
  | "demo";

export interface StatusDef {
  icon: string;
  label: string;
  border: "solid" | "dashed" | "dotted";
  tone: Tone;
}

/** The only place status wording lives (brief: wording rules). Tones follow the map legend
 * (scene/styles.ts): green no known barrier, amber not checked, red not passable / likely flooded,
 * orange possibly flooded. */
export const STATUS: Record<StatusKey, StatusDef> = {
  verified: { icon: "✓", label: "Verified", border: "solid", tone: "cream" },
  reported: { icon: "!", label: "Reported", border: "solid", tone: "amber" },
  unchecked: { icon: "?", label: "Not checked yet", border: "dashed", tone: "lilac" },
  unknown: { icon: "–", label: "Unknown", border: "dotted", tone: "muted" },
  clear: { icon: "○", label: "No known barrier", border: "solid", tone: "ok" },
  blocked: { icon: "×", label: "Not passable", border: "solid", tone: "rose" },
  likely: { icon: "≈", label: "Likely flooded (indicative)", border: "solid", tone: "rose" },
  possibly: { icon: "~", label: "Possibly flooded (indicative)", border: "dashed", tone: "flood" },
  candidate: { icon: "◇", label: "Candidate · from map data", border: "dashed", tone: "peach" },
  official: { icon: "✓", label: "Official relief centre", border: "solid", tone: "cream" },
  gap: { icon: "∅", label: "No mapped connection (data gap)", border: "dotted", tone: "lilac" },
  rejected: { icon: "×", label: "Rejected", border: "solid", tone: "muted" },
  demo: { icon: "◌", label: "Demo value · not surveyed", border: "dashed", tone: "peach" },
};
