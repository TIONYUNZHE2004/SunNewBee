import { describe, expect, it } from "vitest";
import { courseRows, roadKey, SHORT_PATH_M } from "./courseRows";
import seed from "./fixtures/seedCourseRoads.json";

const road = (order: number, name: string, length_m: number) => ({ order, name, length_m });
const total = (rs: { length_m: number }[]) => rs.reduce((a, r) => a + r.length_m, 0);

describe("course card rows (T-028 display)", () => {
  it("keys unnamed stretches by their landmark, not their length, direction or coordinates", () => {
    expect(
      roadKey(
        "unnamed path near Persiaran Elmina (north-east, 12 m path) near 3.1778° N, 101.51° E",
      ),
    ).toBe("unnamed paths near Persiaran Elmina");
    expect(roadKey("Persiaran Tamarind")).toBe("Persiaran Tamarind");
  });

  it("merges consecutive stretches of one road and folds short unnamed paths into one line", () => {
    const { rows, short } = courseRows([
      road(1, "Persiaran Tamarind", 300),
      road(2, "unnamed path near Persiaran Garcinia (north-east, 3 m path)", 3),
      road(3, "unnamed path near Persiaran Garcinia (north-east, 10 m path)", 10),
      road(4, "Persiaran Tamarind", 200),
      road(5, "unnamed path near Iconic Bridge (south-east, 30 m path)", 30),
      road(6, "unnamed path near Iconic Bridge (south-east, 40 m path)", 40),
      road(7, "Persiaran Dillenia", 100),
    ]);
    expect(rows).toEqual([
      { order: 1, name: "Persiaran Tamarind", length_m: 500, stretches: 2 },
      { order: 5, name: "unnamed paths near Iconic Bridge", length_m: 70, stretches: 2 },
      { order: 7, name: "Persiaran Dillenia", length_m: 100, stretches: 1 },
    ]);
    expect(short).toEqual({ stretches: 2, length_m: 13 });
  });

  it("on the seed 5 km course every metre lands in one row or the short line", () => {
    const { rows, short } = courseRows(seed);
    expect(seed).toHaveLength(59);
    expect(total(rows) + short.length_m).toBeCloseTo(total(seed), 6);
    expect(rows).toHaveLength(20); // from 59 engine stretches
    expect(short.stretches).toBe(7);
    expect(short.length_m).toBeCloseTo(154.4, 1);
    expect(rows.every((r) => !r.name.startsWith("unnamed") || r.length_m >= SHORT_PATH_M)).toBe(
      true,
    );
    // no two neighbouring rows name the same road
    expect(rows.every((r, i) => i === 0 || rows[i - 1]?.name !== r.name)).toBe(true);
    expect(rows.find((r) => r.name === "Persiaran Tamarind")?.length_m).toBeCloseTo(1159, 0);
  });
});
