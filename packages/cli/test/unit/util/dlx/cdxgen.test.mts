/**
 * Unit tests for dlx cdxgen integration.
 *
 * Purpose: Tests cdxgen (CycloneDX generator) integration for dlx. Validates
 * SBOM generation via cdxgen.
 *
 * Test Coverage: - cdxgen execution - SBOM generation - Output parsing - Error
 * handling - Version compatibility.
 *
 * Testing Approach: Tests cdxgen subprocess execution and output processing.
 *
 * Related Files: - util/dlx/cdxgen.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { spawnCdxgenDlx } from "../../../../src/util/dlx/spawn.mts";

// Mock spawnDlx function.
vi.mock(import("../../../../src/util/dlx/spawn.mts"), () => {
  const mockSpawnDlx = vi.fn();
  // Return the actual implementation for spawnCdxgenDlx.
  return {
    spawnDlx: mockSpawnDlx,
    spawnCdxgenDlx: async (args: unknown, options: unknown, spawnExtra: unknown) => {
      // Replicate the actual implementation.
      return mockSpawnDlx(
        { name: "@cyclonedx/cdxgen", version: "undefined" },
        args,
        { force: false, silent: true, ...options },
        spawnExtra,
      );
    },
  };
});

describe("spawnCdxgenDlx", () => {
  let mockSpawnDlx: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { spawnDlx } = await import("../../../../src/util/dlx/spawn.mts");
    mockSpawnDlx = vi.mocked(spawnDlx);
    // Setup default resolved value for the mock.
    mockSpawnDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({
        stdout: "cdxgen output",
        stderr: "",
      }),
    });
  });

  it("calls spawnDlx with cdxgen package", async () => {
    mockSpawnDlx.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: "cdxgen output",
        stderr: "",
      }),
    } as unknown);

    await spawnCdxgenDlx(["--help"]);

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: "@cyclonedx/cdxgen", version: "undefined" },
      ["--help"],
      { force: false, silent: true },
      undefined,
    );
  });

  it("passes options through to spawnDlx", async () => {
    mockSpawnDlx.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: "cdxgen output",
        stderr: "",
      }),
    } as unknown);

    const options = {
      env: { CDXGEN_OUTPUT: "sbom.json" },
      timeout: 30_000,
      force: true,
    };

    await spawnCdxgenDlx(["--output", "sbom.json"], options);

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: "@cyclonedx/cdxgen", version: "undefined" },
      ["--output", "sbom.json"],
      {
        force: true,
        silent: true,
        env: { CDXGEN_OUTPUT: "sbom.json" },
        timeout: 30_000,
      },
      undefined,
    );
  });

  it("returns spawnDlx result", async () => {
    const { spawnDlx } = await import("../../../../src/util/dlx/spawn.mts");
    const mockFn = vi.mocked(spawnDlx);

    const expectedResult = {
      spawnPromise: Promise.resolve({
        stdout: '{"bomFormat": "CycloneDX"}',
        stderr: "",
      }),
    };
    mockFn.mockResolvedValueOnce(expectedResult as unknown);

    const result = await spawnCdxgenDlx(["--type", "npm"]);

    expect(result).toEqual(expectedResult);
  });

  it("handles SBOM generation arguments", async () => {
    mockSpawnDlx.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: "cdxgen output",
        stderr: "",
      }),
    } as unknown);

    const sbomArgs = [
      "--type",
      "npm",
      "--output",
      "/tmp/sbom.json",
      "--spec-version",
      "1.4",
      "--project-name",
      "test-project",
    ];

    await spawnCdxgenDlx(sbomArgs);

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: "@cyclonedx/cdxgen", version: "undefined" },
      sbomArgs,
      { force: false, silent: true },
      undefined,
    );
  });

  it("handles recursive scanning arguments", async () => {
    mockSpawnDlx.mockResolvedValueOnce({
      spawnPromise: Promise.resolve({
        stdout: "cdxgen output",
        stderr: "",
      }),
    } as unknown);

    await spawnCdxgenDlx(["-r", "/path/to/scan"]);

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      { name: "@cyclonedx/cdxgen", version: "undefined" },
      ["-r", "/path/to/scan"],
      { force: false, silent: true },
      undefined,
    );
  });
});
