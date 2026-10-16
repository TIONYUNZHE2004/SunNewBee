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
    {
      text: "What if the river rises 3 m and we build a ramp at the steps? Can wheelchair users still reach a centre?",
      profile: "wheelchair",
    },
    { text: "Which places are cut off if the water rises 3 m?" },
    {
      text: "Which facts should staff verify first so wheelchair users can reach a centre?",
      profile: "wheelchair",
    },
    { text: "Tell me about Elmina Lakeside Mall" },
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
