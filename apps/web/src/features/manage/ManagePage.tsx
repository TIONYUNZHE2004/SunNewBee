import { useState } from "react";
import { Link } from "react-router";
import { FloodBriefing } from "./FloodBriefing";
import { VerificationQueue } from "./VerificationQueue";

const TABS = [
  { id: "queue", label: "Verification queue" },
  { id: "flood", label: "Flood briefing" },
] as const;

export function ManagePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("queue");

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
        {tab === "queue" ? <VerificationQueue /> : <FloodBriefing />}
      </div>
    </div>
  );
}
