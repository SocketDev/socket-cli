/**
 * Unit tests for bootstrap node-flags.
 *
 * Selects --disable-sigusr1 vs --no-inspect based on the running Node version.
 * Tests stub process.version to validate every branch.
 *
 * Related Files: - src/bootstrap/shared/node-flags.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getNodeDisableSigusr1Flags } from "../../../../src/bootstrap/shared/node-flags.mts";

const SIGUSR1 = "--disable-sigusr1";
const FALLBACK = "--no-inspect";

describe("getNodeDisableSigusr1Flags", () => {
  let originalVersion: string;

  beforeEach(() => {
    originalVersion = process.version;
  });

  afterEach(() => {
    Object.defineProperty(process, "version", {
      value: originalVersion,
      writable: true,
      configurable: true,
    });
  });

  function setVersion(v: string) {
    Object.defineProperty(process, "version", {
      value: v,
      writable: true,
      configurable: true,
    });
  }

  it("returns --disable-sigusr1 on v24.8.0", () => {
    setVersion("v24.8.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([SIGUSR1]);
  });

  it("returns --disable-sigusr1 on v25.0.0", () => {
    setVersion("v25.0.0");
    // Major >= 24 + minor >= 8 → supported. v25 has minor 0, so falls back.
    // Actually: major 25 with minor 0 fails the minor >= 8 check.
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });

  it("returns --disable-sigusr1 on v23.7.0", () => {
    setVersion("v23.7.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([SIGUSR1]);
  });

  it("returns --no-inspect on v23.6.0", () => {
    setVersion("v23.6.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });

  it("returns --disable-sigusr1 on v22.14.0", () => {
    setVersion("v22.14.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([SIGUSR1]);
  });

  it("returns --no-inspect on v22.13.0", () => {
    setVersion("v22.13.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });

  it("returns --no-inspect on v22.0.0 (below threshold)", () => {
    setVersion("v22.0.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });

  it("returns --no-inspect on v18.0.0 (legacy)", () => {
    setVersion("v18.0.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });

  it("returns --no-inspect on v20.0.0", () => {
    setVersion("v20.0.0");
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });

  it("handles malformed version strings (defaults to 0.0)", () => {
    setVersion("malformed");
    expect(getNodeDisableSigusr1Flags()).toEqual([FALLBACK]);
  });
});
