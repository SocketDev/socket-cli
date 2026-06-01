/**
 * Unit tests for TruffleHog checksums getter.
 *
 * Related Files: - src/env/trufflehog-checksums.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getTrufflehogChecksums,
  requireTrufflehogChecksum,
} from "../../../src/env/trufflehog-checksums.mts";

describe("env/trufflehog-checksums", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env["INLINED_TRUFFLEHOG_CHECKSUMS"];
  });

  afterEach(() => {
    if (original !== undefined) {
      process.env["INLINED_TRUFFLEHOG_CHECKSUMS"] = original;
    } else {
      delete process.env["INLINED_TRUFFLEHOG_CHECKSUMS"];
    }
  });

  describe("getTrufflehogChecksums", () => {
    it("returns empty object when env is missing (dev mode)", () => {
      delete process.env["INLINED_TRUFFLEHOG_CHECKSUMS"];
      expect(getTrufflehogChecksums()).toEqual({});
    });

    it("parses inlined JSON checksums", () => {
      process.env["INLINED_TRUFFLEHOG_CHECKSUMS"] = JSON.stringify({
        "trufflehog-darwin-arm64": "sha-th",
      });
      expect(getTrufflehogChecksums()).toEqual({
        "trufflehog-darwin-arm64": "sha-th",
      });
    });

    it("throws when env contains malformed JSON", () => {
      process.env["INLINED_TRUFFLEHOG_CHECKSUMS"] = "{not";
      expect(() => getTrufflehogChecksums()).toThrow(/TruffleHog.*not valid JSON/);
    });
  });

  describe("requireTrufflehogChecksum", () => {
    it("returns undefined in dev mode", () => {
      delete process.env["INLINED_TRUFFLEHOG_CHECKSUMS"];
      expect(requireTrufflehogChecksum("trufflehog-darwin-arm64")).toBeUndefined();
    });

    it("returns checksum for a known asset", () => {
      process.env["INLINED_TRUFFLEHOG_CHECKSUMS"] = JSON.stringify({
        "trufflehog-darwin-arm64": "sha-th",
      });
      expect(requireTrufflehogChecksum("trufflehog-darwin-arm64")).toBe("sha-th");
    });

    it("throws for unknown asset in production mode", () => {
      process.env["INLINED_TRUFFLEHOG_CHECKSUMS"] = JSON.stringify({
        "trufflehog-darwin-arm64": "sha-th",
      });
      expect(() => requireTrufflehogChecksum("trufflehog-windows-x64")).toThrow(
        /TruffleHog has no SHA-256 checksum/,
      );
    });
  });
});
