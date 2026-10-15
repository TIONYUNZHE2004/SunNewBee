import type { Lens, Profile } from "../scene/sceneStore";

export type ManageTab = "queue" | "flood" | "journeys";

export type StepAction =
  | { kind: "jump"; deepSpotId: string }
  | { kind: "setProfile"; profile: Profile }
  | { kind: "setScenario"; scenarioId: string | null }
  | { kind: "setLens"; lens: Lens; on: boolean }
  | { kind: "ask"; text: string; profile?: Profile; scenarioId?: string | null }
  | { kind: "openManage"; tab: ManageTab }
  | { kind: "wait"; ms: number };

export interface DemoStep {
  caption: string;
  action: StepAction;
}

/**
 * The three README hero flows. Questions used (all have DEMO_MODE cache entries or a
 * deterministic mock answer on the Elmina world). Captions never say "safe", never give a
 * water depth, and never claim a fact is verified.
 */
export const HERO_SCRIPT: DemoStep[] = [
  {
    caption:
      "Access: a resident looks at Elmina Urban Park and the Lakeside Mall frontage in the township model.",
    action: { kind: "jump", deepSpotId: "urban-park" },
  },
  {
    caption: "Pick a persona. This visitor is pushing a stroller.",
    action: { kind: "setProfile", profile: "stroller" },
  },
  {
    caption:
      "The answer states the route status. Unchecked segments are listed as “Not checked yet” and become verification requests for the township team. Placeholder values are labelled “Demo value · not surveyed”.",
    action: {
      kind: "ask",
      text: "Can I get to the lakeside mall with a stroller?",
      profile: "stroller",
      scenarioId: null,
    },
  },
  {
    caption:
      "Flood: the Sungai Subang corridor under an indicative +3 m river-rise scenario. It is not a forecast.",
    action: { kind: "jump", deepSpotId: "subang-corridor" },
  },
  {
    caption: "Switch persona to a wheelchair user.",
    action: { kind: "setProfile", profile: "wheelchair" },
  },
  {
    caption:
      "Indicative, not a forecast. Evacuation centres are labelled candidate (from OSM) or official only when matched to a named source. Check MBSA, JPS and NADMA for guidance.",
    action: {
      kind: "ask",
      text: "Where is the nearest evacuation centre if the water rises 3 m?",
      profile: "wheelchair",
      scenarioId: "stage_p3m",
    },
  },
  {
    caption:
      "Manager: the Flood briefing at +3 m lists counts of affected places, indicative only, with a draft notice for staff to review.",
    action: { kind: "openManage", tab: "flood" },
  },
  {
    caption:
      "Manager: the Verification queue lists gaps the assistant has flagged, for staff to check on site.",
    action: { kind: "openManage", tab: "queue" },
  },
];
