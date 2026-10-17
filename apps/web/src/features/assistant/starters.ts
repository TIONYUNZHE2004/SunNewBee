import type { Mode } from "../../app/modeStore";
import type { IconName } from "../../ui/icons";
import type { Profile } from "../scene/sceneStore";

export interface Starter {
  text: string;
  icon: IconName;
  profile?: Profile;
}

export const STARTERS: Record<Mode, Starter[]> = {
  resident: [
    {
      icon: "stroller",
      text: "Stroller route from Car Park B to the playground",
      profile: "stroller",
    },
    { icon: "wheelchair", text: "Wheelchair route to the lakeside mall", profile: "wheelchair" },
    { icon: "flood", text: "Nearest evacuation centre if the water rises 3 m" },
    {
      icon: "route",
      text: "At which river level does my route from the mall to an evacuation centre break?",
    },
  ],
  management: [
    {
      icon: "wheelchair",
      text: "What if the river rises 3 m and we build a ramp at the steps? Can wheelchair users still reach a centre?",
      profile: "wheelchair",
    },
    { icon: "flood", text: "Which places are cut off if the water rises 3 m?" },
    {
      icon: "check",
      text: "Which facts should staff verify first so wheelchair users can reach a centre?",
      profile: "wheelchair",
    },
    { icon: "walk", text: "What happens to residents in the storm rehearsal?" },
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
