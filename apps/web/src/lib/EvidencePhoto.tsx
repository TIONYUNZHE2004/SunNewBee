import { photoAlt, photoSrc } from "./evidence";

/** Small lazy thumbnail of a stored evidence photo; it opens the full image in a new tab.
 * Renders nothing when there is no usable photo URL. */
export function EvidencePhoto({
  photoUrl,
  element,
  attribute,
  source,
  checked,
}: {
  photoUrl: string | null | undefined;
  element: string;
  attribute: string;
  source?: string | null;
  checked?: string | null;
}) {
  const src = photoSrc(photoUrl);
  if (!src) return null;
  const alt = photoAlt(element, attribute);
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2">
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          width={64}
          height={64}
          className="h-16 w-16 rounded border border-line object-cover"
        />
        <span className="sr-only"> (opens the full image in a new tab)</span>
      </a>
      <span className="text-xs text-ink-soft">
        {source && <span>{source}</span>}
        {source && checked && " · "}
        {checked && <span>checked {checked}</span>}
        <span className="block">Opens the full image in a new tab</span>
      </span>
    </p>
  );
}
