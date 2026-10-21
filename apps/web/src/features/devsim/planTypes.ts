/**
 * The 45 s building plan's fields (spec 2026-10-21 §6.1, §6.2; task C7): the generated schemas
 * (`pnpm gen` from `townshiplens_spatial.devsim_models`), re-exported under the names the web uses.
 * This is the one place the web names them; `types.ts` adds them to `DevelopmentPlan`.
 */
import type { components } from "@tl/api-client";

type S = components["schemas"];

// ---- Schedule and cost ESTIMATE (devsim_schedule.py) --------------------------------------------

export type Schedule = S["Schedule"];
export type ScheduleHoliday = S["ScheduleHoliday"];
export type SchedulePhase = S["SchedulePhase"];
export type MonsoonBand = S["MonsoonBand"];
export type MonsoonMonth = S["MonsoonMonth"];
export type MonsoonSetPiece = S["MonsoonSetPiece"];
export type RayaSetPiece = S["RayaSetPiece"];
export type HolidayStatus = ScheduleHoliday["status"];

/** A row of docs/04-architecture/devsim-estimates-sources.md (`devsim_schedule.SOURCES`). */
export type EstimateSource = S["EstimateSource"];
export type EstimateSourceKind = EstimateSource["kind"];

// ---- Forty simulated residents (devsim_residents.py) --------------------------------------------

export type SimResidents = S["SimResidents"];
export type SimResident = S["SimResident"];
export type ResidentFacts = S["ResidentFacts"];
export type ResidentWalk = S["ResidentWalk"];
export type ResidentLines = S["ResidentLines"];
export type ResidentSide = SimResident["side"];
export type PersonaGroup = SimResident["group"];
export type TargetKind = ResidentWalk["kind"];
/** Minutes for their profile; "?" partly_unverified, "gap" no_data, "blocked". */
export type WalkValue = ResidentWalk["value"];

// ---- Hoarding impact and lorry route (devsim_impact.py) -----------------------------------------

export type HoardingImpact = S["HoardingImpact"];
export type HoardingOption = S["HoardingOption"];
export type HoardingHome = S["HoardingHome"];
export type ImpactTarget = S["ImpactTarget"];
export type LorryRoute = S["LorryRoute"];
export type LorrySensitive = S["LorrySensitive"];
export type LorrySensitiveType = LorrySensitive["type"];

// ---- Flood exposure and the daily-life matrix ---------------------------------------------------

export type FloodExposure = S["FloodExposure"];
export type DevsimEvacuation = S["DevsimEvacuation"];
export type DailyLifeMatrix = S["DailyLifeMatrix"];
export type MatrixRow = S["MatrixRow"];
export type MatrixCell = S["MatrixCell"];

// ---- Timed copy built by the backend (tags, banners, the Impact Brief) --------------------------

export type TimedTag = S["TimedTag"];
export type Banner = S["Banner"];
export type ImpactBrief = S["ImpactBrief"];
export type BriefSection = S["BriefSection"];
export type BriefRow = S["BriefRow"];
/** ROUTE, FLOOD, ESTIMATE, CALENDAR. */
export type BriefBadge = BriefRow["badges"][number];

/** A month key: at screen second t the project is at fractional month m (`plan.month_keys`). */
export type PlanMonthKey = [number, number];

/**
 * The 3D lane's adapter view of the plan (`scene/three/devsim/setPieces.ts` `planExtras`): the C7
 * fields are required on `DevelopmentPlan` now; kept optional here so the legacy 66 s test fixture
 * (no schedule, no route) still reads through the same adapter.
 */
export interface DevelopmentPlanExtras {
  lorry_route?: LorryRoute | null;
  schedule?: Schedule | null;
  /** The nearest playground to the tower entrance (C10 move-in children); absent: the park anchor. */
  playground?: PlaygroundRef | null;
}

/**
 * The plan's nearest playground (be-dev, pending): an id, a name, its [lon, lat] and a walk node.
 * The exact key of the point is not settled yet, so the 3D adapter (`setPieces.ts`
 * `playgroundCoord`) accepts `coord`, `lonlat`, `at` or `point` ([lon, lat]) or `lon` + `lat`.
 */
export interface PlaygroundRef {
  place_id?: string;
  id?: string;
  name?: string;
  coord?: number[];
  lonlat?: number[];
  at?: number[];
  point?: number[];
  lon?: number;
  lat?: number;
  node_id?: string | null;
  walk_node?: string | null;
}
