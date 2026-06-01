/**
 * Unit tests for OpenGrep checksums getter.
 *
 * Reads INLINED_OPENGREP_CHECKSUMS from process.env directly so esbuild's
 * define plugin can inline the JSON at build time.
 *
 * Related Files:
 *
 * - Src/env/opengrep-checksums.mts
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getOpengrepChecksums,
  requireOpengrepChecksum,
} from "../../../src/env/opengrep-checksums.mts";

describe("env/opengrep-checksums", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env["INLINED_OPENGREP_CHECKSUMS"];
  });

  afterEach(() => {
    if (original !== undefined) {
      process.env["INLINED_OPENGREP_CHECKSUMS"] = original;
    } else {
      delete process.env["INLINED_OPENGREP_CHECKSUMS"];
    }
  });

  describe("getOpengrepChecksums", () => {
    it("returns empty object when env is missing (dev mode)", () => {
      delete process.env["INLINED_OPENGREP_CHECKSUMS"];
      expect(getOpengrepChecksums()).toEqual({});
    });

    it("parses inlined JSON checksums", () => {
      process.env["INLINED_OPENGREP_CHECKSUMS"] = JSON.stringify({
        "opengrep-darwin-arm64": "deadbeef",
      });
      expect(getOpengrepChecksums()).toEqual({
        "opengrep-darwin-arm64": "deadbeef",
      });
    });

    it("throws when env contains malformed JSON", () => {
      process.env["INLINED_OPENGREP_CHECKSUMS"] = "{bad json";
      expect(() => getOpengrepChecksums()).toThrow(/OpenGrep.*not valid JSON/);
    });
  });

  describe("requireOpengrepChecksum", () => {
    it("returns undefined in dev mode", () => {
      delete process.env["INLINED_OPENGREP_CHECKSUMS"];
      expect(requireOpengrepChecksum("opengrep-darwin-arm64")).toBeUndefined();
    });

    it("returns checksum for a known asset", () => {
      process.env["INLINED_OPENGREP_CHECKSUMS"] = JSON.stringify({
        "opengrep-darwin-arm64": "deadbeef",
      });
      expect(requireOpengrepChecksum("opengrep-darwin-arm64")).toBe("deadbeef");
    });

    it("throws for unknown asset in production mode", () => {
      process.env["INLINED_OPENGREP_CHECKSUMS"] = JSON.stringify({
        "opengrep-darwin-arm64": "deadbeef",
      });
      expect(() => requireOpengrepChecksum("opengrep-windows-x64")).toThrow(
        /OpenGrep has no SHA-256 checksum/,
      );
    });
  });
});
