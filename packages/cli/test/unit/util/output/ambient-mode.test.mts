/**
 * Unit tests for ambient machine-output mode tracking.
 *
 * Module-scoped let updated by meow at argv-parse time. Tests verify
 * set/get/reset and the delegation to isMachineOutputMode.
 *
 * Related Files: - src/util/output/ambient-mode.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getMachineOutputMode,
  resetMachineOutputMode,
  setMachineOutputMode,
} from "../../../../src/util/output/ambient-mode.mts";

describe("ambient-mode", () => {
  beforeEach(() => {
    resetMachineOutputMode();
  });

  afterEach(() => {
    resetMachineOutputMode();
  });

  it("starts as false", () => {
    expect(getMachineOutputMode()).toBe(false);
  });

  it("switches to true when --json is set", () => {
    setMachineOutputMode({ json: true });
    expect(getMachineOutputMode()).toBe(true);
  });

  it("switches to true when --markdown is set", () => {
    setMachineOutputMode({ markdown: true });
    expect(getMachineOutputMode()).toBe(true);
  });

  it("switches to true when --quiet is set", () => {
    setMachineOutputMode({ quiet: true });
    expect(getMachineOutputMode()).toBe(true);
  });

  it("stays false when no flags are set", () => {
    setMachineOutputMode({});
    expect(getMachineOutputMode()).toBe(false);
  });

  it("reset returns to false after being set", () => {
    setMachineOutputMode({ json: true });
    expect(getMachineOutputMode()).toBe(true);
    resetMachineOutputMode();
    expect(getMachineOutputMode()).toBe(false);
  });

  it("overwrites prior state on each set", () => {
    setMachineOutputMode({ json: true });
    expect(getMachineOutputMode()).toBe(true);
    setMachineOutputMode({});
    expect(getMachineOutputMode()).toBe(false);
  });
});
