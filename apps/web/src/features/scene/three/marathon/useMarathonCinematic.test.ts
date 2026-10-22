import { describe, expect, it } from "vitest";
import { MARATHON } from "../../../closures/fixtures";
import { shotStart } from "../../../closures/marathonCinematic";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { createMarathonCars } from "./marathonCars";
import { suggestionTags } from "./useMarathonCinematic";

describe("T-031 marathon tags and cars", () => {
  it("one tag per detour road a place suggestion names, at that road's first stretch", () => {
    const edges = [
      {
        id: "seg-bc",
        coords: [
          [101.5, 3.1],
          [101.501, 3.1],
          [101.502, 3.1],
        ],
      },
      {
        id: "seg-cd",
        coords: [
          [101.6, 3.1],
          [101.601, 3.1],
        ],
      },
    ];
    // fixture: the signpost names both roads (the longest name, Persiaran Tamarind, wins) and the
    // marshal names Persiaran Tamarind too: one tag, at seg-bc's middle point
    const tags = suggestionTags(MARATHON, edges);
    expect(tags).toEqual([{ text: "Signpost suggested here", at: [101.501, 3.1] }]);
    expect(suggestionTags(MARATHON, [])).toEqual([]);
  });

  it("the sample cars are vehicles-kit cars on the after routes, the followed one first", () => {
    const trip = {
      from_id: "a",
      to_id: "b",
      profile: "drive",
      before_coordinates: [
        [101.5, 3.1],
        [101.51, 3.1],
      ],
      after_coordinates: [
        [101.5, 3.1],
        [101.5, 3.11],
      ],
    };
    const m = { ...MARATHON, animation: { ...MARATHON.animation, rerouted_trips: [trip] } };
    const cars = createMarathonCars(m, createFrame([101.5, 3.1]), {
      roleUniforms: createRoleUniforms(),
    });
    cars.update(shotStart("car") + 5);
    expect(cars.drawn()).toBe(1);
    expect(cars.mesh.count).toBe(1);
    cars.dispose();
  });
});
