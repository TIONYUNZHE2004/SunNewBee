/** Relative luminance of "#rrggbb" (WCAG). */
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (l[0] ?? 0) + 0.7152 * (l[1] ?? 0) + 0.0722 * (l[2] ?? 0);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const DARK = "#1c1b19";

/** The initial's colour on a resident colour: white or ink, whichever reads better. */
export function inkOn(hex: string): string {
  const bg = lum(hex);
  return ratio(bg, 1) >= ratio(bg, lum(DARK)) ? "#ffffff" : DARK;
}

/** "Pak Cik Halim" -> "H"; "Mak Cik Zainab" -> "Z". */
export const initialOf = (name: string) => name.replace(/^(Pak Cik|Mak Cik) /, "").charAt(0);

/** A resident's colour dot, with their initial when `name` is given. */
export function Avatar({
  colour,
  name,
  size = "md",
}: {
  colour: string;
  name?: string;
  size?: "xs" | "md";
}) {
  const cls =
    size === "xs"
      ? "-mr-[7px] size-[22px] border-2 border-fg"
      : "mx-auto mb-[3px] grid size-7 place-items-center text-xs font-extrabold";
  return (
    <span
      aria-hidden="true"
      className={`block rounded-full ${cls}`}
      style={{ background: colour, color: inkOn(colour) }}
    >
      {name ? initialOf(name) : null}
    </span>
  );
}
