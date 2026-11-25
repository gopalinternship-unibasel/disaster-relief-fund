// Runs the build guide's test table (and the extra checks) against the real compiled contract on
// the in-browser chain. The app's Test checklist page runs exactly the same list.
import { describe, expect, it } from "vitest";
import { CHECKS, runCheck } from "../src/checks/guide-checks";

describe("guide test table", () => {
  for (const check of CHECKS) {
    it(`${check.test}: ${check.expected}`, async () => {
      const result = await runCheck(check);
      expect(result.actual).not.toMatch(/^The check stopped/);
      expect(result.pass, result.actual).toBe(true);
    });
  }
});
