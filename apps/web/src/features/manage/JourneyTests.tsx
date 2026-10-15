import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useScenarios } from "../../lib/api";
import { CreateVrButton } from "./CreateVrButton";
import {
  ApiError,
  fetchSimReport,
  fetchSimRuns,
  runSimulation,
  type SimReport,
  type SimSummary,
} from "./manageApi";
import {
  advisoryLabel,
  checkSummary,
  checkSummaryText,
  isCriticalViolation,
  OUTCOMES,
  outcomeLabel,
  profileLabel,
  restAdvisoryText,
  summariseCounts,
  violationLabel,
} from "./simModel";
import { useStaffToken } from "./useStaffToken";

const PROFILE_CHOICES = ["stroller", "wheelchair", "older_adult_rest"] as const;
const inputCls = "min-h-11 w-full rounded-md border border-line bg-card px-3 text-sm";
const btnCls =
  "min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";

export function simErrorMessage(err: unknown): string {
  if (err instanceof ApiError && (err.status === 401 || err.status === 503))
    return "Staff token required or not configured";
  if (err instanceof ApiError && err.status === 422) return "That scenario is not available.";
  return "Journey tests could not be run. Please try again.";
}

const when = (iso: string) => new Date(iso).toLocaleString();
const scenarioName = (id?: string | null) => id ?? "baseline";

export function JourneyTests() {
  const qc = useQueryClient();
  const scenarios = useScenarios();
  const [token, setToken] = useStaffToken();
  const [scenarioId, setScenarioId] = useState("baseline");
  const [profiles, setProfiles] = useState<string[]>([...PROFILE_CHOICES]);
  const [report, setReport] = useState<SimReport | null>(null);
  const [loadError, setLoadError] = useState(false);
  const runs = useQuery({
    queryKey: ["manage", "sim-runs"],
    queryFn: () => fetchSimRuns(5),
    retry: false,
  });

  const run = useMutation({
    mutationFn: () =>
      runSimulation(
        { scenario_id: scenarioId === "baseline" ? null : scenarioId, profiles },
        token,
      ),
    onSuccess: (r) => {
      setReport(r);
      setLoadError(false);
      void qc.invalidateQueries({ queryKey: ["manage", "sim-runs"] });
    },
  });
  const load = useMutation({
    mutationFn: (id: string) => fetchSimReport(id),
    onSuccess: (r) => {
      setReport(r);
      setLoadError(false);
    },
    onError: () => setLoadError(true),
  });

  const noProfiles = profiles.length === 0;
  const options = scenarios.data ?? [];
  const summary = report ? summariseCounts(report) : null;

  return (
    <section aria-labelledby="jt-h" className="space-y-5">
      <div>
        <h2 id="jt-h" className="text-xl font-semibold">
          Journey tests
        </h2>
        <p className="text-sm text-ink-soft">
          Simulated residents plan routes across the township. Gaps show which unverified facts
          block the most journeys.
        </p>
      </div>

      <form
        className="space-y-3 rounded-lg border border-line bg-card p-3"
        aria-label="Run journey tests"
        onSubmit={(e) => {
          e.preventDefault();
          if (!noProfiles && !run.isPending) run.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="jt-token" className="mb-1 block text-sm font-medium">
              Staff token
            </label>
            <input
              id="jt-token"
              type="password"
              autoComplete="off"
              className={inputCls}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-soft">Kept for this browser session only.</p>
          </div>
          <div>
            <label htmlFor="jt-sc" className="mb-1 block text-sm font-medium">
              Scenario
            </label>
            <select
              id="jt-sc"
              className={inputCls}
              value={scenarioId}
              disabled={run.isPending}
              onChange={(e) => setScenarioId(e.target.value)}
            >
              <option value="baseline">Baseline (no flooding)</option>
              {options
                .filter((s) => s.id !== "baseline")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <fieldset className="space-y-1" disabled={run.isPending}>
          <legend className="mb-1 text-sm font-medium">Mobility profiles</legend>
          <div className="flex flex-wrap gap-x-5">
            {PROFILE_CHOICES.map((p) => (
              <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={profiles.includes(p)}
                  onChange={(e) =>
                    setProfiles(
                      e.target.checked ? [...profiles, p] : profiles.filter((x) => x !== p),
                    )
                  }
                />
                {profileLabel(p)}
              </label>
            ))}
          </div>
        </fieldset>
        {noProfiles && (
          <p className="text-sm text-ink-soft" id="jt-np">
            Choose at least one profile to run.
          </p>
        )}
        <button
          type="submit"
          className={btnCls}
          disabled={run.isPending || noProfiles}
          aria-describedby={noProfiles ? "jt-np" : undefined}
        >
          {run.isPending ? "Running journey tests…" : "Run journey tests"}
        </button>
        {run.isError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {simErrorMessage(run.error)}{" "}
            {!(run.error instanceof ApiError && [401, 503, 422].includes(run.error.status)) && (
              <button type="button" className="underline" onClick={() => run.mutate()}>
                Retry
              </button>
            )}
          </p>
        )}
      </form>

      <div role="status" aria-live="polite" className="text-sm">
        {run.isPending && "Running journey tests…"}
        {load.isPending && "Loading report…"}
        {!run.isPending && !load.isPending && report && summary && (
          <span className="font-medium">
            Run {report.run_id.slice(0, 8)} finished: {summary.overall.total} journeys,{" "}
            {summary.overall.confirmedPct}% confirmed, {summary.overall.blockedPct}% not passable,{" "}
            {summary.overall.noDataPct}% no mapped connection (data gap), {report.gaps.length} top
            gaps, {checkSummaryText(checkSummary(report))}.
          </span>
        )}
      </div>
      {loadError && (
        <p role="alert" className="text-sm font-medium text-danger">
          That report could not be loaded.
        </p>
      )}

      {!report && !run.isPending && !load.isPending && (
        <p className="rounded-lg border border-line bg-card p-4 text-sm">
          No report yet. Run the journey tests or open a recent run.
        </p>
      )}

      {report && summary && <JourneyReport report={report} summary={summary} />}

      <RecentRuns
        runs={runs}
        onOpen={(id) => load.mutate(id)}
        busy={load.isPending}
        current={report?.run_id}
      />
    </section>
  );
}

export function JourneyReport({
  report,
  summary,
}: {
  report: SimReport;
  summary: ReturnType<typeof summariseCounts>;
}) {
  const profileRows = Object.keys(report.counts);
  const advisories = report.rest_advisories ?? [];
  const advisoryKinds = [...new Set(advisories.map((a) => a.kind))];
  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-soft">
        Scenario: {scenarioName(report.scenario_id)} · {when(report.created_at)} · world version{" "}
        {report.world_version}
      </p>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Outcome matrix</h3>
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Journey outcomes by mobility profile, as counts and share of journeys
            </caption>
            <thead className="bg-brand-tint">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Profile
                </th>
                {OUTCOMES.map((o) => (
                  <th key={o} scope="col" className="px-3 py-2 font-medium">
                    {outcomeLabel(o)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profileRows.map((p) => {
                const pc = summary.byProfile[p];
                const share = [pc?.confirmedPct, pc?.possiblePct, pc?.blockedPct, pc?.noDataPct];
                return (
                  <tr key={p} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {profileLabel(p)}
                    </th>
                    {OUTCOMES.map((o, i) => (
                      <td key={o} className="px-3 py-2">
                        {report.counts[p]?.[o] ?? 0}{" "}
                        <span className="text-ink-soft">({share[i] ?? 0}%)</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
              {profileRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-ink-soft">
                    No journeys were run.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Top gaps</h3>
        {report.gaps.length === 0 ? (
          <p className="rounded-lg border border-line bg-card p-3 text-sm">
            No data gaps found in this run.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Unverified facts ranked by journeys they would unblock
              </caption>
              <thead className="bg-brand-tint">
                <tr>
                  {["Element", "Attribute", "Impact", "Profiles", "Action"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.gaps.map((g) => (
                  <tr
                    key={`${g.element_id}/${g.attribute}`}
                    className="border-t border-line align-top"
                  >
                    <th scope="row" className="px-3 py-2 font-medium">
                      {g.element_id}
                    </th>
                    <td className="px-3 py-2">{g.attribute}</td>
                    <td className="px-3 py-2">
                      unblocks {g.impact} {g.impact === 1 ? "journey" : "journeys"}
                    </td>
                    <td className="px-3 py-2">
                      {g.affected_profiles.map(profileLabel).join(", ")}
                    </td>
                    <td className="px-3 py-2">
                      <CreateVrButton elementId={g.element_id} attribute={g.attribute} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.gaps_truncated && (
          <p className="text-sm text-ink-soft">
            Results truncated by time budget: some journeys were not tested, so gaps may be
            incomplete.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Invariant violations</h3>
        <p className="text-sm text-ink-soft">
          Critical checks: a route broke an honesty rule. These need a fix in the routing code.
        </p>
        {report.invariant_violations.length === 0 ? (
          <p className="rounded-lg border border-line bg-card p-3 text-sm">
            No critical invariant violations.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.invariant_violations.map((v) => (
              <li
                key={`${v.invariant}/${v.task_id}/${v.detail}`}
                className="rounded-lg border border-line bg-card p-3 text-sm"
              >
                <p className="font-medium">
                  {violationLabel(v.invariant)}{" "}
                  <span className="text-ink-soft">
                    ({v.invariant}
                    {isCriticalViolation(v.invariant) ? ", critical" : ""})
                  </span>
                </p>
                <p className="text-ink-soft">
                  Journey {v.task_id}: {v.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Advisory notes</h3>
        <p className="text-sm text-ink-soft">
          Not errors. The best route for an older resident runs further between rest points
          (benches, seats, shelters) than the profile allows. Residents see it as possible, never
          confirmed, with the longest stretch named.
        </p>
        {advisories.some((a) => a.kind === "rest_limit_no_alternative") && (
          <p className="text-sm font-medium">{restAdvisoryText(report)}</p>
        )}
        {advisories.length === 0 ? (
          <p className="rounded-lg border border-line bg-card p-3 text-sm">No advisory notes.</p>
        ) : (
          advisoryKinds.map((k) => {
            const items = advisories.filter((a) => a.kind === k);
            return (
              <details key={k} className="rounded-lg border border-line bg-card p-3 text-sm">
                <summary className="min-h-11 cursor-pointer font-medium">
                  {advisoryLabel(k)}: {items.length}
                </summary>
                <ul className="mt-2 space-y-1">
                  {items.map((a) => (
                    <li key={`${a.task_id}/${a.detail}`} className="text-ink-soft">
                      Journey {a.task_id}: {a.detail}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}

function RecentRuns({
  runs,
  onOpen,
  busy,
  current,
}: {
  runs: { isPending: boolean; isError: boolean; data?: SimSummary[]; refetch: () => unknown };
  onOpen: (id: string) => void;
  busy: boolean;
  current?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Recent runs</h3>
      {runs.isPending ? (
        <p role="status" className="text-sm text-ink-soft">
          Loading recent runs…
        </p>
      ) : runs.isError ? (
        <p role="alert" className="text-sm">
          Recent runs unavailable.{" "}
          <button type="button" className="underline" onClick={() => runs.refetch()}>
            Retry
          </button>
        </p>
      ) : (runs.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-soft">No runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {(runs.data ?? []).map((r) => (
            <li key={r.run_id}>
              <button
                type="button"
                disabled={busy}
                aria-current={current === r.run_id ? "true" : undefined}
                onClick={() => onOpen(r.run_id)}
                className="min-h-11 w-full rounded-md border border-line bg-card px-3 py-2 text-left text-sm hover:bg-brand-tint disabled:opacity-50"
              >
                {when(r.created_at)} · {scenarioName(r.scenario_id)} · {r.task_count} journeys ·{" "}
                {r.gap_count} gaps · {r.violation_count} violations
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
