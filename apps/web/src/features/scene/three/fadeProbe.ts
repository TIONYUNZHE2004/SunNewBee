/**
 * Latest fade level of the decorative dressing (AC-B9): the largest drawn weight (0..1) and the
 * drawn count. Written by the dressing driver on every fade pass, read by the acceptance hook.
 * Display-only probe with no imports, so the hook can read it without reaching the dressing modules.
 */
export const dressingFadeProbe = { maxW: 0, decor: 0, nowMs: 0 };
