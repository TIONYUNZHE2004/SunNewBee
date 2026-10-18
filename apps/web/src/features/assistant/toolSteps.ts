import type { ToolChip } from "../chat/chatReducer";

const PROFILE: Record<string, string> = {
  stroller: "stroller",
  wheelchair: "wheelchair",
  older_adult_rest: "older-adult",
  walk: "walking",
};

type Names = Map<string, string>;
type Phrase = [running: string, done: string];

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** A place id's mapped name, else a neutral word: raw ids never reach the step list. */
const place = (v: unknown, names: Names, fallback: string) => {
  const id = str(v);
  return (id && names.get(id)) || fallback;
};
const stage = (v: unknown) => {
  const m = /^stage_p(\d+(?:\.\d+)?)m$/.exec(str(v) ?? "");
  return m ? `river +${m[1]} m (indicative)` : undefined;
};
const who = (v: unknown) => {
  const p = PROFILE[str(v) ?? ""];
  return p ? `${p} ` : "";
};

function phrase(t: ToolChip, names: Names): Phrase {
  const a = t.args ?? {};
  switch (t.name) {
    case "find_place": {
      const q = str(a.query);
      return q
        ? [`Looking up “${q}”`, `Looked up “${q}”`]
        : ["Looking up places", "Looked up places"];
    }
    case "get_place_details": {
      const p = place(a.place_id, names, "the place");
      return [`Reading the facts for ${p}`, `Read the facts for ${p}`];
    }
    case "plan_route": {
      const from = place(a.from_id, names, "the start");
      const to = place(a.to_id, names, "the destination");
      const at = stage(a.scenario_id);
      const tail = `${who(a.profile)}route from ${from} to ${to}${at ? ` at ${at}` : ""}`;
      return [`Checking each path on a ${tail}`, `Checked each path on a ${tail}`];
    }
    case "nearby_amenities": {
      const p = place(a.origin_id, names, "the start");
      return [`Finding facilities near ${p}`, `Found facilities near ${p}`];
    }
    case "get_closures":
      return ["Checking reported closures", "Checked reported closures"];
    case "create_verification_request":
      return [
        "Asking the township team to check a fact",
        "Asked the township team to check a fact",
      ];
    case "list_flood_scenarios":
      return ["Loading the indicative flood scenarios", "Loaded the indicative flood scenarios"];
    case "affected_places": {
      const at = stage(a.scenario_id) ?? "the chosen scenario";
      return [`Finding places affected at ${at}`, `Found places affected at ${at}`];
    }
    case "list_evacuation_centres":
      return ["Listing relief centres", "Listed relief centres"];
    case "find_waste_points":
      return ["Finding waste points", "Found waste points"];
    case "river_tipping_point":
      return [
        "Finding the river level where the route stops working",
        "Found the river level where the route stops working",
      ];
    case "rising_river_rollout":
      return ["Rehearsing a rising river", "Rehearsed a rising river"];
    case "simulate_what_if":
      return ["Testing an imagined change on a copy", "Tested an imagined change on a copy"];
    case "suggest_interventions":
    case "find_fixes":
      return ["Looking for fixes", "Looked for fixes"];
    case "plan_verifications":
      return ["Ranking which checks matter most", "Ranked which checks matter most"];
    case "day_rehearsal":
    case "day_test_change":
      return [
        "Rehearsing a day with synthetic residents",
        "Rehearsed a day with synthetic residents",
      ];
    case "rehearse_my_trip":
      return ["Rehearsing your trip", "Rehearsed your trip"];
    default: {
      const n = t.name.replace(/_/g, " ");
      return [n, n];
    }
  }
}

/** One plain sentence per tool call: what the assistant is doing (running) or did (done). Built
 * from tool names, ids and the lookup text only; never states a result or a fact. */
export function toolStep(t: ToolChip, names: Names): string {
  const [running, done] = phrase(t, names);
  return t.done ? done : running;
}
