/** "Simulation · illustrative" (spec D8): persistent while a Development Simulation is shown. */
export function SimBadge({ text }: { text: string }) {
  return (
    <p
      role="note"
      aria-label={text}
      data-testid="devsim-sim-badge"
      data-devsim="simBadge"
      className="glass m-0 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-fg"
    >
      <span aria-hidden="true" className="size-2.5 rounded-full bg-[#f5c518]" />
      <span>{text}</span>
    </p>
  );
}
