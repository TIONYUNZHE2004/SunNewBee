import { Link, useSearchParams } from "react-router";
import { Closures } from "./Closures";
import { FloodBriefing } from "./FloodBriefing";
import { JourneyTests } from "./JourneyTests";
import { KpiTiles } from "./KpiTiles";
import { VerificationQueue } from "./VerificationQueue";

const TABS = [
  { id: "queue", label: "Verification queue" },
  { id: "briefing", label: "Flood briefing" },
  { id: "journeys", label: "Journey tests" },
  { id: "closures", label: "Closures" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** `/manage?tab=briefing` opens that tab (used by the demo walkthrough); anything else is the queue.
 * `flood` is the pre-Task 50 name of the briefing tab and still works. */
export function tabFromParam(v: string | null): TabId {
  if (v === "flood") return "briefing";
  return TABS.find((t) => t.id === v)?.id ?? "queue";
}

export function ManagePage() {
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  // replace, not push: switching tabs must not fill the Back stack.
  const setTab = (id: TabId) => setParams({ tab: id }, { replace: true });

  function onKey(e: React.KeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = TABS[(i + d + TABS.length) % TABS.length];
    if (!n) return;
    setTab(n.id);
    document.getElementById(`mtab-${n.id}`)?.focus();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Management</h1>
        <Link to="/" className="text-sm text-brand underline">
          ← Back to resident view
        </Link>
      </div>
      <KpiTiles />
      <div
        role="tablist"
        aria-label="Management sections"
        className="inline-flex overflow-hidden rounded-lg border border-line bg-card"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            id={`mtab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`mpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`min-h-11 px-4 text-sm font-medium ${tab === t.id ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`mpanel-${tab}`} role="tabpanel" aria-labelledby={`mtab-${tab}`}>
        {tab === "queue" ? (
          <VerificationQueue />
        ) : tab === "briefing" ? (
          <FloodBriefing />
        ) : tab === "closures" ? (
          <Closures />
        ) : (
          <JourneyTests />
        )}
      </div>
    </div>
  );
}
