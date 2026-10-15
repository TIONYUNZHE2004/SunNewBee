import { Button } from "../../ui/Button";
import { CitationList } from "../chat/CitationList";
import { type AssistantMessage, isRefusal } from "../chat/chatReducer";
import { describeUncertainty } from "../chat/uncertainty";
import { useElementNames } from "../chat/useElementNames";

export function AnswerCard({ m, onRetry }: { m: AssistantMessage; onRetry: () => void }) {
  const names = useElementNames();
  const thinking = !m.done && !m.text && !m.error;
  const refusal = isRefusal(m);
  const tone = m.error
    ? "border-rose bg-danger-tint"
    : refusal
      ? "border-dashed border-lilac bg-raised"
      : "border-edge bg-raised";
  const uncertain =
    m.uncertainty && m.uncertainty.level !== "none"
      ? describeUncertainty(m.uncertainty.items as Record<string, string>[])
      : [];
  const links = (m.disclaimer?.links ?? [])
    .map((l) => ({ href: l.url ?? l.href, label: l.label ?? l.title ?? l.name }))
    .filter((l) => l.href && /^https?:\/\//.test(l.href));

  return (
    <article
      data-done={m.done || m.error ? "true" : "false"}
      className={`space-y-3 rounded-lg border p-3 text-sm text-fg ${tone}`}
    >
      {refusal && (
        <p className="inline-block rounded-full border border-dashed border-lilac px-2.5 py-0.5 text-xs text-lilac">
          Can't answer that yet
        </p>
      )}
      {m.tools.length > 0 && (
        <ol aria-label="Checks the assistant ran" className="space-y-1 text-xs text-fg-soft">
          {m.tools.map((t) => (
            <li key={t.id} className="flex items-center gap-1.5">
              {t.done ? (
                <span aria-hidden="true">✓</span>
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-block size-3 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"
                />
              )}
              {t.name.replace(/_/g, " ")}
              <span className="sr-only">{t.done ? " done" : " running"}</span>
            </li>
          ))}
        </ol>
      )}
      {thinking && (
        <p className="text-fg-soft">
          Checking the data<span aria-hidden="true">…</span>
        </p>
      )}
      {m.text && (
        <p className="whitespace-pre-wrap">
          {m.text}
          {!m.done && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block w-1.5 bg-fg motion-safe:animate-pulse"
            >
              &nbsp;
            </span>
          )}
        </p>
      )}
      {uncertain.length > 0 && (
        <div
          role="note"
          className="rounded-md border border-dashed border-lilac px-3 py-2 text-lilac"
        >
          <span aria-hidden="true">? </span>
          <strong>Not verified · </strong>
          {uncertain.join("; ")}
        </div>
      )}
      {m.disclaimer && (
        <div role="note" className="rounded-md border border-edge px-3 py-2 text-lantern">
          <span aria-hidden="true">≈ </span>
          {m.disclaimer.text}
          {links.length > 0 && (
            <span className="mt-1 block">
              Official sources:{" "}
              {links.map((l, i) => (
                <span key={l.href}>
                  {i > 0 && ", "}
                  <a className="underline" href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.label ?? l.href}
                  </a>
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      {m.citations.length > 0 && (
        <section aria-label="Evidence">
          <CitationList citations={m.citations} names={names} />
        </section>
      )}
      {m.vrs.length > 0 && (
        <p className="text-fg-soft">
          {m.vrs.length === 1 ? "A check has" : `${m.vrs.length} checks have`} been requested from
          the township team.
        </p>
      )}
      {m.error && (
        <div role="alert" className="space-y-2">
          <p>{m.error}</p>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </article>
  );
}
