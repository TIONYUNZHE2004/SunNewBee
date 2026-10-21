import { splitTag } from "./copy";

/**
 * A ROUTE ENGINE tag under a bubble (spec D8): the numbers computed by the routing engine, never
 * inside the speech itself. The text is the plan's tag, split into its source and its numbers.
 */
export function RouteTag({ tag }: { tag: string }) {
  const { head, body } = splitTag(tag);
  return (
    <p
      role="note"
      data-testid="devsim-route-tag"
      aria-label={tag}
      className="m-0 mt-1.5 inline-block rounded-lg border-2 border-[#2f7fd1] bg-surface px-2.5 py-1 text-xs font-semibold text-fg"
    >
      {head && (
        <span className="block text-[10px] uppercase tracking-wide text-fg-soft">{head}</span>
      )}
      <span className="block">{body}</span>
    </p>
  );
}
