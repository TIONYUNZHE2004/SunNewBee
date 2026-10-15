/**
 * Returns a recorder that reports true once `threshold` failures happen within `windowMs`.
 * Single tile failures are normal while photoreal tiles stream; only a burst means the
 * tileset is really unavailable (quota, key or network).
 */
export function failureBurst(threshold: number, windowMs: number): (now: number) => boolean {
  const times: number[] = [];
  return (now) => {
    times.push(now);
    while (times.length > 0 && now - (times[0] as number) > windowMs) times.shift();
    return times.length >= threshold;
  };
}
