/**
 * Unit tests for OpenGrep version getter.
 *
 * The getter reads INLINED_OPENGREP_VERSION from process.env directly so
 * esbuild's define plugin can inline the value at build time. Tests verify the
 * runtime success and the missing-env throw.
 *
 * Related Files:
 *
 * - Src/env/opengrep-version.mts
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getOpengrepVersion } from "../../../src/env/opengrep-version.mts";

describe("env/opengrep-version", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env["INLINED_OPENGREP_VERSION"];
  });

  afterEach(() => {
    if (original !== undefined) {
      process.env["INLINED_OPENGREP_VERSION"] = original;
    } else {
      delete process.env["INLINED_OPENGREP_VERSION"];
    }
  });

  it("returns the version string when the env var is set", () => {
    process.env["INLINED_OPENGREP_VERSION"] = "1.2.3";
    expect(getOpengrepVersion()).toBe("1.2.3");
  });

  it("throws a build-time-inlined message when the env var is missing", () => {
    delete process.env["INLINED_OPENGREP_VERSION"];
    expect(() => getOpengrepVersion()).toThrow(/INLINED_OPENGREP_VERSION/);
  });

  it("throws when the env var is the empty string", () => {
    process.env["INLINED_OPENGREP_VERSION"] = "";
    expect(() => getOpengrepVersion()).toThrow(/INLINED_OPENGREP_VERSION/);
  });
});
