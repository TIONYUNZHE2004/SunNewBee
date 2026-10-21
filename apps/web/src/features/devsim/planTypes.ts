/**
 * Demo-polish additions to the Development Simulation contract (spec 2026-10-21 §6.1, §6.2).
 *
 * Hand mirror of `townshiplens_spatial.devsim_models` (`Schedule`, `SimResidents`, …) and of
 * `devsim_schedule.Source`, shaped as `pnpm gen` emits them (non-null defaults required, `None`
 * defaults optional and nullable). PRE-C7: the backend `DevelopmentPlan` does not carry these yet;
 * task C7 adds them to the plan payload, and aligning the web is a change to this one file (swap to
 * `components["schemas"][...]` and add the fields to `DevelopmentPlan` in `types.ts`).
 */

// ---- Schedule and cost ESTIMATE (devsim_schedule.py) --------------------------------------------

export type HolidayStatus = "gazetted" | "expected";

export interface ScheduleHoliday {
  /** ISO date. */
  date: string;
  name: string;
  /** "expected" for years whose official list is not yet gazetted (shown as "expected"). */
  status: HolidayStatus;
  /** Months after the start month (0 = the start month). */
  month_index: number;
  /** Falls on a site working day (Mon-Sat). */
  working_day: boolean;
}

export interface SchedulePhase {
  name: "foundation" | "structure" | "fit-out";
  /** ISO date, inclusive. */
  start: string;
  /** ISO date, exclusive. */
  end: string;
}

export interface MonsoonBand {
  /** "YYYY-MM". */
  start_month: string;
  /** "YYYY-MM", inclusive. */
  end_month: string;
  start_index: number;
  /** Inclusive. */
  end_index: number;
}

export interface RayaSetPiece {
  /** Hari Raya Aidilfitri, day 1 (ISO date). */
  date: string;
  month_index: number;
  /** Site shutdown in working days (labelled assumption). */
  days: number;
}

export interface MonsoonMonth {
  /** "YYYY-MM". */
  month: string;
  month_index: number;
  wet_days: number;
  days_lost: number;
}

export interface MonsoonSetPiece {
  start_month: string;
  end_month: string;
  months: MonsoonMonth[];
}

export interface Schedule {
  storeys: number;
  homes: number;
  start: string;
  handover: string;
  /** Calendar months from the start month to the handover month, inclusive. */
  months_total: number;
  /** "YYYY-MM" per month index. */
  months: string[];
  phases: SchedulePhase[];
  /** Floors topped out by the end of each month. */
  floors_by_month: number[];
  gfa_m2: number;
  rate_rm_per_m2: number;
  cost_total_rm: number;
  /** Cumulative RM by the end of each month (S-curve), ending at the total. */
  cost_by_month: number[];
  holidays: ScheduleHoliday[];
  holiday_days_lost: number;
  /** ISO dates of the holidays that cost a structure working day. */
  holidays_lost: string[];
  rain_days_lost: number;
  raya_shutdown_days: number;
  monsoon_bands: MonsoonBand[];
  raya_set_piece?: RayaSetPiece | null;
  monsoon_set_piece?: MonsoonSetPiece | null;
  source_ids: string[];
  /** "ESTIMATE". */
  label: string;
  source_line: string;
}

export type EstimateSourceKind = "gazetted" | "benchmark" | "climatology" | "assumption";

/** A row of docs/04-architecture/devsim-estimates-sources.md (`devsim_schedule.SOURCES`). */
export interface EstimateSource {
  id: string;
  value: number;
  unit: string;
  kind: EstimateSourceKind;
  label: string;
}

// ---- Forty simulated residents (devsim_residents.py) --------------------------------------------

export type ResidentSide = "tower" | "neighbour";
export type PersonaGroup = "older" | "parent" | "commuter" | "wheelchair" | "general";
export type TargetKind = "park" | "mall" | "clinic" | "school";
/** Minutes for their profile; "?" partly_unverified, "gap" no_data, "blocked". */
export type WalkValue = number | "?" | "gap" | "blocked";

export interface ResidentWalk {
  kind: TargetKind;
  name: string;
  value: WalkValue;
  arrival_id: string;
  label: string;
}

export interface ResidentFacts {
  profile: string;
  home_id: string | null;
  extra_walk_min?: number | null;
  extra_walk_to?: string | null;
  extra_walk_arrival?: string | null;
  walks: ResidentWalk[];
}

export interface ResidentLines {
  construction: string;
  handover: string;
  daily_life: string;
}

export interface SimResident {
  id: string;
  name: string;
  role: string;
  side: ResidentSide;
  group: PersonaGroup;
  colour: string;
  age?: number | null;
  tags: string[];
  facts: ResidentFacts;
  lines: ResidentLines;
}

export interface SimResidents {
  /** 20 tower, then 20 neighbours. */
  residents: SimResident[];
  seed: number;
  /** "Simulated reactions". */
  label: string;
  /** "Lines are written for the simulation; every number comes from the world model." */
  note: string;
}
