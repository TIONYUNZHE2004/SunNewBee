import { useQuery } from "@tanstack/react-query";
import { kpiTexts } from "./kpiModel";
import { fetchKpis, fetchSimRuns, type Kpis } from "./manageApi";
import { summariseCounts } from "./simModel";

type Props = {
  state: "loading" | "error" | "ready";
  kpis?: Kpis;
  noDataPct?: number | null;
};

function Tile({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
      {note && <dd className="text-xs text-ink-soft">{note}</dd>}
    </div>
  );
}

export function KpiTilesView(p: Props) {
  if (p.state === "loading")
    return (
      <p role="status" className="text-sm text-ink-soft">
        Loading key figures…
      </p>
    );
  if (p.state === "error")
    return (
      <p role="alert" className="text-sm">
        Key figures unavailable.
      </p>
    );
  if (!p.kpis) return null;
  const t = kpiTexts(p.kpis, p.noDataPct ?? null);
  return (
    <dl aria-label="Key figures" className="grid gap-3 sm:grid-cols-3">
      <Tile label="Open verification requests" value={t.open} />
      <Tile label="Median hours to resolve" value={t.median} />
      <Tile label="Journeys confirmed (latest run)" value={t.journeys} note={t.dataGap} />
    </dl>
  );
}

export function KpiTiles() {
  const k = useQuery({ queryKey: ["manage", "kpis"], queryFn: fetchKpis, retry: false });
  // The latest run's counts carry the no-data share; /kpis only has the confirmed share.
  const runs = useQuery({
    queryKey: ["manage", "sim-runs", "latest"],
    queryFn: () => fetchSimRuns(1),
    retry: false,
  });
  if (k.isPending) return <KpiTilesView state="loading" />;
  if (k.isError) return <KpiTilesView state="error" />;
  const latest = runs.data?.[0];
  const noDataPct = latest ? summariseCounts(latest).overall.noDataPct : null;
  return <KpiTilesView state="ready" kpis={k.data} noDataPct={noDataPct} />;
}
