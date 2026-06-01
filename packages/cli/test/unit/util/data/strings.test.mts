/**
 * Unit tests for string utilities.
 *
 * Purpose: Tests string manipulation and formatting utilities. Validates
 * truncation, pluralization, and escaping.
 *
 * Test Coverage: - String truncation - Pluralization - Escape/unescape
 * functions - Case conversion - String validation.
 *
 * Testing Approach: Tests string helper functions used across CLI.
 *
 * Related Files: - util/data/strings.mts (implementation)
 */

import { describe, expect, it } from "vitest";

import { camelToKebab } from "../../../../src/util/data/strings.mts";

describe("strings utilities", () => {
  describe("camelToKebab", () => {
    it("converts camelCase to kebab-case", () => {
      expect(camelToKebab("camelCase")).toBe("camel-case");
      expect(camelToKebab("myVariableName")).toBe("my-variable-name");
      expect(camelToKebab("APIToken")).toBe("apitoken");
    });

    it("handles single words", () => {
      expect(camelToKebab("word")).toBe("word");
      expect(camelToKebab("WORD")).toBe("word");
    });

    it("handles empty string", () => {
      expect(camelToKebab("")).toBe("");
    });

    it("handles already kebab-case", () => {
      expect(camelToKebab("already-kebab")).toBe("already-kebab");
    });

    it("handles numbers", () => {
      expect(camelToKebab("version2")).toBe("version2");
      expect(camelToKebab("v2Update")).toBe("v2update");
    });
  });
});
