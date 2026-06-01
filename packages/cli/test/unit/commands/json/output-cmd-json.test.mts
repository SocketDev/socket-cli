/**
 * @file Unit tests for json command output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock(import("node:fs"), () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
}));

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
}));

vi.mock(import("@socketsecurity/lib-stable/logger"), () => ({
  getDefaultLogger: () => mockLogger,
}));

const mockSafeReadFileSync = vi.fn();
const mockSafeStatsSync = vi.fn();

vi.mock(import("@socketsecurity/lib-stable/fs/read-file"), () => ({
  safeReadFileSync: (...args: unknown[]) => mockSafeReadFileSync(...args),
}));
vi.mock(import("@socketsecurity/lib-stable/fs/inspect"), () => ({
  safeStatSync: (...args: unknown[]) => mockSafeStatsSync(...args),
}));

import { outputCmdJson } from "../../../../src/commands/json/output-cmd-json.mts";

describe("output-cmd-json", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  describe("outputCmdJson", () => {
    it("logs info about target cwd", async () => {
      mockExistsSync.mockReturnValue(false);

      await outputCmdJson("/test/path");

      expect(mockLogger.info).toHaveBeenCalledWith("Target cwd:", expect.any(String));
    });

    it("handles socket.json not found", async () => {
      mockExistsSync.mockReturnValue(false);

      await outputCmdJson("/test/path");

      expect(mockLogger.fail).toHaveBeenCalledWith(expect.stringContaining("Not found"));
      expect(process.exitCode).toBe(1);
    });

    it("handles non-file (directory) path", async () => {
      mockExistsSync.mockReturnValue(true);
      mockSafeStatsSync.mockReturnValue({
        isFile: () => false,
      });

      await outputCmdJson("/test/path");

      expect(mockLogger.fail).toHaveBeenCalledWith(expect.stringContaining("not a regular file"));
      expect(process.exitCode).toBe(1);
    });

    it("successfully reads and outputs socket.json contents", async () => {
      const mockContent = JSON.stringify({ version: "1.0.0" }, null, 2);
      mockExistsSync.mockReturnValue(true);
      mockSafeStatsSync.mockReturnValue({
        isFile: () => true,
      });
      mockSafeReadFileSync.mockReturnValue(mockContent);

      await outputCmdJson("/test/path");

      expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining("contents of"));
      expect(mockLogger.log).toHaveBeenCalledWith(mockContent);
      expect(process.exitCode).toBeUndefined();
    });

    it("handles null safeStatSync result", async () => {
      mockExistsSync.mockReturnValue(true);
      mockSafeStatsSync.mockReturnValue(undefined);

      await outputCmdJson("/test/path");

      expect(mockLogger.fail).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("uses tildified paths when VITEST is false", async () => {
      // Re-import with VITEST mocked to false to exercise the tildify branch.
      vi.resetModules();
      vi.doMock(import("../../../../src/env/vitest.mts"), () => ({ VITEST: false }));

      const { outputCmdJson: realOutputCmdJson } =
        await import("../../../../src/commands/json/output-cmd-json.mts");
      mockExistsSync.mockReturnValue(false);
      await realOutputCmdJson("/test/path");

      // When VITEST=false, the path is tildified rather than redacted.
      // The info message should not contain "[REDACTED]".
      const infoCalls = mockLogger.info.mock.calls.flat().join(" ");
      expect(infoCalls).not.toContain("[REDACTED]");

      vi.doUnmock(import("../../../../src/env/vitest.mts"));
    });
  });
});
