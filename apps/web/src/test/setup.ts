// Runs before every test file. Only files that opt in with `// @vitest-environment jsdom`
// have a `document`; node-environment files skip all of this, so they are unchanged.
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  // Vitest has no globals here, so Testing Library cannot register its own auto-cleanup.
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
  });
}
