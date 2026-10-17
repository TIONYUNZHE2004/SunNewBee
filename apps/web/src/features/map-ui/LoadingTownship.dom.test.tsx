// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingTownship } from "./LoadingTownship";

describe("LoadingTownship", () => {
  it("is a status region reading 'Loading the township'", () => {
    render(<LoadingTownship />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the township");
  });
});
