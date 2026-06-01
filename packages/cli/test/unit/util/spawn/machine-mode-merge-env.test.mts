/**
 * Direct tests for the now-exported mergeEnv helper from
 * util/spawn/machine-mode.mts.
 *
 * Related Files: - src/util/spawn/machine-mode.mts.
 */

import { describe, expect, it } from "vitest";

import { mergeEnv } from "../../../../src/util/spawn/machine-mode.mts";

describe("mergeEnv", () => {
  it("layers UNIVERSAL_ENV over base, then overrides over UNIVERSAL_ENV", () => {
    const result = mergeEnv(
      { BASE_KEY: "base-value", NO_COLOR: "maybe" },
      { OVERRIDE_KEY: "override-value" },
    );
    // overrides win
    expect(result["OVERRIDE_KEY"]).toBe("override-value");
    // base passes through (when not shadowed by UNIVERSAL_ENV)
    expect(result["BASE_KEY"]).toBe("base-value");
    // UNIVERSAL_ENV overrides base
    expect(result["NO_COLOR"]).toBe("1");
  });

  it("handles undefined base", () => {
    const result = mergeEnv(undefined, { CUSTOM: "x" });
    expect(result["CUSTOM"]).toBe("x");
    expect(result["NO_COLOR"]).toBe("1");
  });

  it("lets caller-supplied overrides win even over UNIVERSAL_ENV", () => {
    const result = mergeEnv(undefined, { NO_COLOR: "caller-wins" });
    expect(result["NO_COLOR"]).toBe("caller-wins");
  });
});
