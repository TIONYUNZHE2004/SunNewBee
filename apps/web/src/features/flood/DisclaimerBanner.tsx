export type DisclaimerLink = Record<string, string>;

function linkParts(l: DisclaimerLink): { href: string; label: string } | null {
  const href = l.url ?? l.href;
  if (!href || !/^https?:\/\//.test(href)) return null;
  return { href, label: l.label ?? l.title ?? l.name ?? href };
}

/** Persistent flood-scenario disclaimer. Never claims safety. */
export function DisclaimerBanner({
  text,
  links,
  className = "",
}: {
  text: string;
  links?: DisclaimerLink[];
  className?: string;
}) {
  const parts = (links ?? []).map(linkParts).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div
      role="note"
      aria-label="Flood scenario disclaimer"
      className={`rounded-lg border border-[#DD6B20] bg-warn-tint px-3 py-2 text-sm ${className}`}
    >
      <p>
        <span aria-hidden="true">⚠ </span>
        <strong>Indicative only. </strong>
        {text}
      </p>
      {parts.length > 0 && (
        <p className="mt-1">
          Official sources:{" "}
          {parts.map((p, i) => (
            <span key={p.href}>
              {i > 0 && ", "}
              <a className="underline" href={p.href} target="_blank" rel="noreferrer noopener">
                {p.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
