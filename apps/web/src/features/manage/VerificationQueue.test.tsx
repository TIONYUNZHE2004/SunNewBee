import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VR } from "../tickets/manageApi";
import { ResolveForm } from "./VerificationQueue";

const vr = (current_value: unknown): VR => ({
  id: "vr-1",
  element_id: "seg-cf",
  attribute: "incline_pct",
  reason: "unknown",
  status: "open",
  demand: 1,
  created_at: "2026-10-15T00:00:00Z",
  current_value,
});
const html = (v: VR) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ResolveForm vr={v} token="t" onDone={() => {}} />
    </QueryClientProvider>,
  );

describe("ResolveForm defaults", () => {
  it("claim with no value: Verify disabled with a reason, starts on Correct", () => {
    const h = html(vr(null));
    expect(h).toContain("Nothing to verify yet: enter the observed value with Correct");
    expect(h).toMatch(/<option value="verify" disabled/);
    expect(h).toMatch(/<option value="correct" selected/);
    expect(h).toContain("Corrected value");
  });
  it("claim with a value: Verify enabled and selected", () => {
    const h = html(vr(3));
    expect(h).not.toContain("Nothing to verify yet");
    expect(h).not.toMatch(/<option value="verify" disabled/);
    expect(h).toMatch(/<option value="verify" selected/);
  });
});
