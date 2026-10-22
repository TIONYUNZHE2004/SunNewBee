/** Wording the product must never render (AGENTS.md honesty invariants). */
export const BANNED = /\bsafe\b|selamat|安全/i;
/** A measured water depth, e.g. "0.5 m deep". */
export const DEPTH = /\b\d+(\.\d+)?\s?(m|cm|metres?)\b[^.]{0,20}\b(deep|depth)/i;
/** The word itself, e.g. "depth of 2 m" or "water depth 30 cm". */
export const DEPTH_WORD = /\bdepths?\b/i;

export function honestyViolations(text: string): string[] {
  const out: string[] = [];
  if (BANNED.test(text)) out.push(`banned safety wording: ${BANNED.exec(text)?.[0]}`);
  if (DEPTH.test(text)) out.push(`water depth: ${DEPTH.exec(text)?.[0]}`);
  // Yunzhe's T-032 override requires this exact limit beside illustrative water.
  // A depth claim elsewhere in the same text must still fail.
  const claims = text.replaceAll("Water look is illustrative; depth not modelled.", "");
  if (DEPTH_WORD.test(claims)) out.push(`depth wording: ${DEPTH_WORD.exec(claims)?.[0]}`);
  return out;
}

/** Throws when the text makes a safety claim or states a water depth. */
export function assertHonest(text: string): void {
  const v = honestyViolations(text);
  if (v.length) throw new Error(`Honesty violation: ${v.join("; ")}`);
}
