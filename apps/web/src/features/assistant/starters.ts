import type { Mode } from "../../app/modeStore";
import type { Profile } from "../scene/sceneStore";

export interface Starter {
  text: string;
  profile?: Profile;
}

export const STARTERS: Record<Mode, Starter[]> = {
  resident: [
    { text: "Stroller route from Car Park B to the playground", profile: "stroller" },
    { text: "Wheelchair route to the lakeside mall", profile: "wheelchair" },
    { text: "Nearest evacuation centre if the water rises 3 m" },
    { text: "Where to drop off recycling" },
  ],
  management: [
    { text: "Which places are cut off at +3 m" },
    { text: "Which areas are isolated at +5 m" },
    { text: "Which routes to the mall are cut off at +3 m" },
    { text: "Tell me about a place" },
  ],
};

export function copyFor(mode: Mode) {
  return mode === "resident"
    ? {
        title: "Ask about getting around",
        sub: "Ask in your own words. Answers only come from checked data and say what isn't verified.",
        placeholder: "Describe where you want to go",
      }
    : {
        title: "Ask about the township",
        sub: "Ask about an area or a scenario. Gaps in the data become tickets for your team.",
        placeholder: "Describe your plan or ask about an area",
      };
}
