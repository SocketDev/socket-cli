/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for path resolution utilities.
 *
 * Purpose: Tests path resolution and normalization. Validates absolute path
 * construction and relative path handling.
 *
 * Test Coverage: - Absolute path resolution - Relative path handling - Path
 * normalization - Symlink resolution - Cross-platform path separators.
 *
 * Testing Approach: Tests path utilities with various input formats.
 *
 * Related Files: - util/fs/path-resolve.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { WIN32 } from "@socketsecurity/lib-stable/constants/platform";
import { normalizePath } from "@socketsecurity/lib-stable/paths/normalize";

import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from "../../../../src/constants/packages.mts";
import {
  findBinPathDetailsSync,
  getPackageFilesForScan,
} from "../../../../src/util/fs/path-resolve.mts";
import { createTestWorkspace } from "../../../helpers/workspace-helper.mts";

import type * as BinResolveModule from "@socketsecurity/lib-stable/bin/resolve";
import type * as BinWhichModule from "@socketsecurity/lib-stable/bin/which";
import type * as FsInspectModule from "@socketsecurity/lib-stable/fs/inspect";

const PACKAGE_JSON = "package.json";

// Hoisted mocks for better CI reliability.
const mockWhichRealSync = vi.hoisted(() => vi.fn());
const mockResolveRealBinSync = vi.hoisted(() => vi.fn((p: string) => p));

// Mock dependencies for new tests.
vi.mock(import("@socketsecurity/lib-stable/bin/resolve"), async () => {
  const actual = await vi.importActual<typeof BinResolveModule>(
    "@socketsecurity/lib-stable/bin/resolve",
  );
  return {
    ...actual,
    resolveRealBinSync: mockResolveRealBinSync,
  };
});

vi.mock(import("@socketsecurity/lib-stable/bin/which"), async () => {
  const actual = await vi.importActual<typeof BinWhichModule>(
    "@socketsecurity/lib-stable/bin/which",
  );
  return {
    ...actual,
    whichRealSync: mockWhichRealSync,
  };
});

vi.mock(import("@socketsecurity/lib-stable/fs/inspect"), async () => {
  const actual = await vi.importActual<typeof FsInspectModule>(
    "@socketsecurity/lib-stable/fs/inspect",
  );
  return {
    ...actual,
    isDirSync: vi.fn(),
  };
});

const globPatterns = {
  general: {
    readme: {
      pattern: "*readme*",
    },
    notice: {
      pattern: "*notice*",
    },
    license: {
      pattern: "{licen{s,c}e{,-*},copying}",
    },
  },
  npm: {
    packagejson: {
      pattern: PACKAGE_JSON,
    },
    packagelockjson: {
      pattern: PACKAGE_LOCK_JSON,
    },
    npmshrinkwrap: {
      pattern: "npm-shrinkwrap.json",
    },
    yarnlock: {
      pattern: YARN_LOCK,
    },
    pnpmlock: {
      pattern: PNPM_LOCK_YAML,
    },
    pnpmworkspace: {
      pattern: "pnpm-workspace.yaml",
    },
  },
  pypi: {
    pipfile: {
      pattern: "pipfile",
    },
    pyproject: {
      pattern: "pyproject.toml",
    },
    requirements: {
      pattern: "{*requirements.txt,requirements/*.txt,requirements-*.txt,requirements.frozen}",
    },
    setuppy: {
      pattern: "setup.py",
    },
  },
};

type Fn = (...args: unknown[]) => Promise<unknown[]>;

const sortedPromise =
  (fn: Fn) =>
  async (...args: unknown[]) => {
    const result = await fn(...args);
    return result.toSorted();
  };
const sortedGetPackageFilesFullScans = sortedPromise(getPackageFilesForScan);

describe("Path Resolve", () => {
  describe("getPackageFilesForScan()", () => {
    it('should handle a "." inputPath', async () => {
      const workspace = await createTestWorkspace({
        packageJson: { name: "test" },
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["."], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should respect ignores from socket config", async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: "bar/package-lock.json", content: "{}" },
          { path: "bar/package.json", content: "{}" },
          { path: "foo/package-lock.json", content: "{}" },
          { path: "foo/package.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
          config: {
            version: 2,
            projectIgnorePaths: ["bar/*", "!bar/package.json"],
            issueRules: {},
            githubApp: {},
          },
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("bar/package.json")),
          normalizePath(workspace.resolve("foo/package-lock.json")),
          normalizePath(workspace.resolve("foo/package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should respect .gitignore", async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: ".gitignore", content: "bar/*\n!bar/package.json" },
          { path: "bar/package-lock.json", content: "{}" },
          { path: "bar/package.json", content: "{}" },
          { path: "foo/package-lock.json", content: "{}" },
          { path: "foo/package.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("bar/package.json")),
          normalizePath(workspace.resolve("foo/package-lock.json")),
          normalizePath(workspace.resolve("foo/package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should always ignore some paths", async () => {
      const workspace = await createTestWorkspace({
        files: [
          // Mirrors the list from
          // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
          { path: ".git/some/dir/package.json", content: "{}" },
          { path: ".log/some/dir/package.json", content: "{}" },
          { path: ".nyc_output/some/dir/package.json", content: "{}" },
          { path: ".sass-cache/some/dir/package.json", content: "{}" },
          { path: ".yarn/some/dir/package.json", content: "{}" },
          { path: "bower_components/some/dir/package.json", content: "{}" },
          { path: "coverage/some/dir/package.json", content: "{}" },
          { path: "node_modules/socket/package.json", content: "{}" },
          { path: "foo/package-lock.json", content: "{}" },
          { path: "foo/package.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("foo/package-lock.json")),
          normalizePath(workspace.resolve("foo/package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should ignore irrelevant matches", async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: "foo/package-foo.json", content: "{}" },
          { path: "foo/package-lock.json", content: "{}" },
          { path: "foo/package.json", content: "{}" },
          { path: "foo/random.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("foo/package-lock.json")),
          normalizePath(workspace.resolve("foo/package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should be lenient on oddities", async () => {
      const workspace = await createTestWorkspace({});

      try {
        // Create empty package.json directory (not a file)
        await workspace.writeFile("package.json/.gitkeep", "");

        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should resolve package and lockfile", async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: "package-lock.json", content: "{}" },
          { path: "package.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("package-lock.json")),
          normalizePath(workspace.resolve("package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should resolve package without lockfile", async () => {
      const workspace = await createTestWorkspace({
        files: [{ path: "package.json", content: "{}" }],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should support alternative lockfiles", async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: "yarn.lock", content: "{}" },
          { path: "package.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("package.json")),
          normalizePath(workspace.resolve("yarn.lock")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });

    it("should handle all variations", async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: "package-lock.json", content: "{}" },
          { path: "package.json", content: "{}" },
          { path: "foo/package-lock.json", content: "{}" },
          { path: "foo/package.json", content: "{}" },
          { path: "bar/yarn.lock", content: "{}" },
          { path: "bar/package.json", content: "{}" },
          { path: "abc/package.json", content: "{}" },
        ],
      });

      try {
        const actual = await sortedGetPackageFilesFullScans(["**/*"], globPatterns, {
          cwd: workspace.path,
        });
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve("abc/package.json")),
          normalizePath(workspace.resolve("bar/package.json")),
          normalizePath(workspace.resolve("bar/yarn.lock")),
          normalizePath(workspace.resolve("foo/package-lock.json")),
          normalizePath(workspace.resolve("foo/package.json")),
          normalizePath(workspace.resolve("package-lock.json")),
          normalizePath(workspace.resolve("package.json")),
        ]);
      } finally {
        await workspace.cleanup();
      }
    });
  });

  describe("findBinPathDetailsSync", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("finds bin path when available", () => {
      mockWhichRealSync.mockReturnValue(["/usr/local/bin/npm"]);

      const result = findBinPathDetailsSync("npm");

      expect(result).toEqual({
        name: "npm",
        path: "/usr/local/bin/npm",
      });
    });

    it("handles no bin path found", () => {
      mockWhichRealSync.mockReturnValue(undefined);

      const result = findBinPathDetailsSync("nonexistent");

      expect(result).toEqual({
        name: "nonexistent",
        path: undefined,
      });
    });

    it("handles empty array result", () => {
      mockWhichRealSync.mockReturnValue([]);

      const result = findBinPathDetailsSync("npm");

      expect(result).toEqual({
        name: "npm",
        path: undefined,
      });
    });

    it("handles single string result", () => {
      mockWhichRealSync.mockReturnValue("/usr/local/bin/npm" as unknown);

      const result = findBinPathDetailsSync("npm");

      expect(result).toEqual({
        name: "npm",
        path: "/usr/local/bin/npm",
      });
    });
  });
});
