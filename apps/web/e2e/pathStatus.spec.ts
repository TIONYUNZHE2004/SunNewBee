import { expect, test } from "@playwright/test";

// AC-A1 (settings popover half): a fresh profile starts with Path status off, the legend hides the
// status rows, the choice survives a reload. Runs on the tiny fixture (List view).
test("Path status is off on a fresh profile, toggles the legend rows and survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Map settings" }).click();
  const group = page.getByRole("radiogroup", { name: "Path status" });
  await expect(group.getByRole("radio", { name: "Path status off" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const legend = page.getByRole("list", { name: "Path status legend" });
  await expect(legend.getByText("Not checked yet")).toHaveCount(0);
  await expect(legend.getByText("Suggested route")).toBeVisible();

  await group.getByRole("radio", { name: "Path status on" }).click();
  await expect(legend.getByText("Not checked yet")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Map settings" }).click();
  await expect(
    page
      .getByRole("radiogroup", { name: "Path status" })
      .getByRole("radio", { name: "Path status on" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("list", { name: "Path status legend" }).getByText("Not checked yet"),
  ).toBeVisible();
});
