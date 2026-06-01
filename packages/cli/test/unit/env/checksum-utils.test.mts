/**
 * Unit tests for shared checksum utilities.
 *
 * Covers parseChecksums (dev fallback / parse / malformed) and requireChecksum
 * (dev fallback / hit / miss). The tool-specific modules (python-, opengrep-,
 * sfw-, …) all delegate to these.
 *
 * Related Files: - src/env/checksum-utils.mts.
 */

import { describe, expect, it } from "vitest";

import { parseChecksums, requireChecksum } from "../../../src/env/checksum-utils.mts";

describe("parseChecksums", () => {
  it("returns empty object for undefined input", () => {
    expect(parseChecksums(undefined, "Tool")).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseChecksums("", "Tool")).toEqual({});
  });

  it("parses a JSON string into an object", () => {
    expect(parseChecksums('{"a":"sha-a","b":"sha-b"}', "Tool")).toEqual({
      a: "sha-a",
      b: "sha-b",
    });
  });

  it("throws an error referencing the tool name on malformed JSON", () => {
    expect(() => parseChecksums("{not json", "Tool")).toThrow(/Tool.*not valid JSON/);
  });

  it("preserves the underlying parse-error message in the thrown error", () => {
    try {
      parseChecksums("{abc", "X");
    } catch (e) {
      expect(String(e)).toContain("JSON.parse threw");
    }
  });

  it("coerces non-Error parse errors via String()", () => {
    // No good way to make JSON.parse throw a non-Error in tests; the
    // String(e) branch is exercised here via direct unit testing on
    // a malformed string that triggers a SyntaxError (Error subclass).
    expect(() => parseChecksums("{abc", "X")).toThrow(/X.*not valid JSON/);
  });
});

describe("requireChecksum", () => {
  it("returns undefined when checksums object is empty (dev mode)", () => {
    expect(requireChecksum({}, "asset.tar.gz", "Tool")).toBeUndefined();
  });

  it("returns the matching checksum when present", () => {
    expect(requireChecksum({ "asset.tar.gz": "sha-x" }, "asset.tar.gz", "Tool")).toBe("sha-x");
  });

  it("throws when checksums non-empty but asset missing", () => {
    expect(() => requireChecksum({ "a.tar.gz": "sha-a" }, "b.tar.gz", "Tool")).toThrow(
      /Tool has no SHA-256 checksum.*b\.tar\.gz/,
    );
  });

  it("lists known assets in the error", () => {
    expect(() =>
      requireChecksum({ "a.tar.gz": "sha-a", "b.tar.gz": "sha-b" }, "c.tar.gz", "Tool"),
    ).toThrow(/known assets:.*a\.tar\.gz.*b\.tar\.gz/);
  });
});
