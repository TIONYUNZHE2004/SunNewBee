import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { assumptionRows, type ProfileInfo } from "./comparison";

const BASIS = "our engineering default (no published source)";

export function AssumptionsView({
  profiles,
  selected,
}: {
  profiles: Pick<
    ProfileInfo,
    "id" | "label" | "hard" | "max_rest_free_run_m" | "threshold_basis"
  >[];
  selected: string;
}) {
  const p = profiles.find((x) => x.id === selected);
  const rows = p ? assumptionRows(p) : [];
  return (
    <details className="rounded-lg border border-line bg-card p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Assumptions</summary>
      <p className="text-sm">
        Flood classes are indicative, from a terrain model, and are not a forecast. Profile
        thresholds are {p?.threshold_basis ?? BASIS}.
      </p>
      {p && rows.length > 0 ? (
        <dl className="mt-2 space-y-1 text-sm">
          <p className="font-medium">{p.label}</p>
          {rows.map((r) => (
            <div key={r.label} className="flex flex-wrap justify-between gap-2">
              <dt>{r.label}</dt>
              <dd>
                {r.value} <span className="text-ink-soft">({p.threshold_basis})</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">
          This profile has no fixed hard limits; it only weights routes.
        </p>
      )}
    </details>
  );
}

export function Assumptions({ selected }: { selected: string }) {
  const q = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const r = await api.GET("/profiles");
      if (!r.data) throw new Error("profiles unavailable");
      return r.data;
    },
    retry: false,
  });
  if (q.isError)
    return (
      <p role="status" className="text-sm text-ink-soft">
        Assumptions unavailable.
      </p>
    );
  return <AssumptionsView profiles={q.data ?? []} selected={selected} />;
}
