/**
 * DLX execution utilities for Socket CLI. Manages package execution using
 * Socket's own dlx implementation.
 *
 * Key Functions:
 *
 * - SpawnCdxgenDlx: Execute CycloneDX generator via dlx
 * - SpawnCoanaDlx: Execute Coana CLI tool via dlx
 * - SpawnDlx: Execute packages using Socket's dlx
 * - SpawnSfwDlx: Execute Socket Firewall via dlx
 * - SpawnSocketPyCli: Execute Socket Python CLI
 * - SpawnSocketPatchDlx: Execute Socket Patch via dlx
 * - SpawnSynpDlx: Execute Synp converter via dlx
 *
 * Implementation:
 *
 * - Uses @socketsecurity/lib/dlx/package for direct package installation
 * - Installs packages to ~/.socket/_dlx directory
 * - Executes binaries directly without package manager commands
 */

import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import { joinAnd } from "@socketsecurity/lib-stable/arrays/join";
import { downloadBinary, getDlxCachePath } from "@socketsecurity/lib-stable/dlx/binary";
import { dlxPackage } from "@socketsecurity/lib-stable/dlx/package";
import { safeDelete, safeMkdir } from "@socketsecurity/lib-stable/fs/safe";
import { spawn } from "@socketsecurity/lib-stable/process/spawn/child";
import { whichReal } from "@socketsecurity/lib-stable/bin/which";

import type { GitHubReleaseSpec } from "./resolve-binary.mjs";
import { areExternalToolsAvailable, extractExternalTools } from "./vfs-extract.mjs";
import { InputError } from "../error/errors.mts";

import type { IpcObject } from "../ipc.mts";
import type { ExternalTool } from "./vfs-extract.mjs";
import type { StdioOptions } from "node:child_process";
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from "@socketsecurity/lib-stable/process/spawn/types";

type DlxSpawnOptions = SpawnOptions & {
  ipc?: IpcObject | undefined;
};

export type DlxSpawnResult = {
  spawnPromise: SpawnResult;
};

export type DlxOptions = DlxSpawnOptions & {
  agent?: "npm" | "pnpm" | "yarn" | undefined;
  force?: boolean | undefined;
  silent?: boolean | undefined;
};

export type CoanaDlxOptions = DlxOptions & {
  coanaVersion?: string | undefined;
};

export type DlxPackageSpec = {
  binaryName?: string | undefined;
  name: string;
  version: string;
};

/**
 * Helper to spawn Coana with dlx. Returns a CResult with stdout extraction for
 * backward compatibility.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 */
export { spawnCoanaDlx } from "./spawn-coana.mts";

export { spawnCdxgenDlx } from "./spawn-cdxgen.mts";

export { spawnSfwDlx } from "./spawn-sfw.mts";

/**
 * Helper to spawn Socket Patch. If SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH
 * environment variable is set, uses the local socket-patch binary at that path
 * instead of downloading.
 *
 * Note: As of v2.0.0, socket-patch is a Rust binary downloaded from GitHub
 * releases, not an npm package. This function handles both local overrides and
 * GitHub downloads.
 */
export { spawnSocketPatchDlx } from "./spawn-socket-patch.mts";

/**
 * Download and cache a binary from GitHub releases. Handles both .tar.gz and
 * .zip archives, extracting the binary to the dlx cache.
 *
 * Security: - Uses lock files to prevent TOCTOU race conditions during
 * concurrent downloads. - Validates zip entries for path traversal attacks
 * before extraction. - Verifies SHA-256 checksum if provided in spec.
 *
 * @param spec - GitHub release specification.
 *
 * @returns Path to the downloaded binary.
 */
export async function downloadGitHubReleaseBinary(spec: GitHubReleaseSpec): Promise<string> {
  const { assetName, binaryName, owner, repo, sha256, version } = spec;
  const isPlatWin = os.platform() === "win32";
  const binaryFileName = binaryName + (isPlatWin ? ".exe" : "");

  // Cache path: ~/.socket/_dlx/github/{owner}/{repo}/{version}/
  const cacheDir = path.join(getDlxCachePath(), "github", owner, repo, version);
  const normalizedCacheDir = path.resolve(cacheDir);
  const binaryPath = path.join(cacheDir, binaryFileName);
  const lockFile = path.join(cacheDir, ".downloading");

  // Check if already downloaded.
  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  await safeMkdir(cacheDir);

  // TOCTOU protection: use lock file to prevent concurrent downloads.
  try {
    await fs.writeFile(lockFile, process.pid.toString(), { flag: "wx" });
  } catch (e: unknown) {
    const error = e as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      // Another process is downloading; wait for completion.
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        if (existsSync(binaryPath)) {
          return binaryPath;
        }
        // Check if lock holder is still alive.
        if (i % 5 === 4) {
          try {
            const lockPid = await fs.readFile(lockFile, "utf8");
            const pid = Number.parseInt(lockPid.trim(), 10);
            if (!Number.isNaN(pid) && pid > 0) {
              try {
                process.kill(pid, 0);
              } catch {
                // Process died, lock is stale - remove and retry.
                await safeDelete(lockFile, { force: true });
                return downloadGitHubReleaseBinary(spec);
              }
            }
          } catch {
            // Lock file gone, retry.
            return downloadGitHubReleaseBinary(spec);
          }
        }
      }
      throw new InputError(
        `timed out waiting for another socket process to finish downloading ${owner}/${repo}@${version} (${assetName}); if no other socket process is running, remove stale lock files under ${path.dirname(binaryPath)} and retry`,
      );
    }
    throw e;
  }

  try {
    // Re-check after acquiring lock (another process may have finished).
    if (existsSync(binaryPath)) {
      return binaryPath;
    }

    // Download the archive using downloadBinary (handles caching internally).
    const url = `https://github.com/${owner}/${repo}/releases/download/${version}/${assetName}`;

    const result = await downloadBinary({
      name: `${owner}-${repo}-${version}-${assetName}`,
      sha256,
      url,
    });

    // Extract based on archive type.
    const isZip = assetName.endsWith(".zip");
    const isTarGz = assetName.endsWith(".tar.gz") || assetName.endsWith(".tgz");

    if (isZip) {
      // Extract zip using adm-zip (cross-platform, zero dependencies).
      const zip = new AdmZip(result.binaryPath);

      // Security: validate all entries for path traversal before extraction.
      const entries = zip.getEntries();
      for (let i = 0, { length } = entries; i < length; i += 1) {
        const entry = entries[i]!;
        const entryPath = path.resolve(path.join(cacheDir, entry.entryName));
        if (!entryPath.startsWith(normalizedCacheDir)) {
          throw new InputError(
            `archive entry "${entry.entryName}" resolves outside the cache dir (${normalizedCacheDir}) — this looks like a zip-slip attack; do NOT trust this release asset, report it to the upstream project, and delete ${result.binaryPath}`,
          );
        }
      }

      zip.extractAllTo(cacheDir, true);

      // Security: validate no symlinks escape the cache directory after extraction.
      const extractedFiles = await fs.readdir(cacheDir, { recursive: true });
      for (let i = 0, { length } = extractedFiles; i < length; i += 1) {
        const file = extractedFiles[i]!;
        const fullPath = path.join(cacheDir, file);
        // oxlint-disable-next-line socket/prefer-exists-sync -- reads .isSymbolicLink() metadata for symlink escape validation.
        const stats = await fs.lstat(fullPath);
        if (stats.isSymbolicLink()) {
          const target = await fs.readlink(fullPath);
          const resolvedTarget = path.resolve(path.dirname(fullPath), target);
          if (!resolvedTarget.startsWith(normalizedCacheDir)) {
            await safeDelete(fullPath, { force: true });
            throw new InputError(
              `extracted symlink ${file} targets ${resolvedTarget} which is outside the cache dir (${normalizedCacheDir}); do NOT trust this release asset, report it to the upstream project, and delete ${cacheDir}`,
            );
          }
        }
      }
    } else if (isTarGz) {
      // Extract tar.gz using system tar.
      // Note: tar has built-in path traversal protection by default.
      const tarPath = await whichReal("tar", { nothrow: true });
      if (!tarPath || Array.isArray(tarPath)) {
        throw new InputError(
          `tar is required to extract ${assetName} but was not found on PATH; install tar (e.g. \`apt install tar\`, \`brew install gnu-tar\`) and re-run`,
        );
      }
      await spawn(tarPath, ["-xzf", result.binaryPath, "-C", cacheDir], {});
    } else {
      throw new InputError(
        `archive format of ${assetName} is not supported (expected .zip or .tar.gz / .tgz); check the asset name in bundle-tools.json and the release's actual asset list`,
      );
    }

    // Verify binary was extracted.
    if (!existsSync(binaryPath)) {
      throw new InputError(
        `archive ${assetName} extracted but ${binaryFileName} was not found inside (expected at ${binaryPath}); the release's archive layout may have changed — verify asset contents and update bundle-tools.json`,
      );
    }

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(binaryPath, 0o755);
    }

    return binaryPath;
  } finally {
    // Clean up lock file.
    await safeDelete(lockFile, { force: true });
  }
}

/**
 * Spawns a package using Socket's dlx implementation. Installs packages to
 * ~/.socket/_dlx and executes them directly.
 */
export async function spawnDlx(
  packageSpec: DlxPackageSpec,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const { force = false, ...spawnOpts } = options ?? {};

  // Validate package name for security.
  validatePackageName(packageSpec.name);

  const packageString = `${packageSpec.name}@${packageSpec.version}`;

  // Use Socket's dlxPackage to install and execute.
  const result = await dlxPackage(
    args,
    {
      package: packageString,
      binaryName: packageSpec.binaryName,
      force,
      spawnOptions: spawnOpts,
    },
    spawnExtra,
  );

  return {
    spawnPromise: result.spawnPromise as unknown as SpawnResult,
  };
}

/**
 * Helper to spawn a tool from VFS extraction. Used when running in SEA mode.
 */
export async function spawnToolVfs(
  tool: ExternalTool,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (!areExternalToolsAvailable()) {
    throw new Error(
      `cannot spawn ${tool} from VFS: external tools were not bundled into this SEA binary; rebuild the SEA with INLINED_SOCKET_CLI_INCLUDE_EXTERNAL_TOOLS=1 or run the non-SEA CLI`,
    );
  }

  // Extract tools from VFS (returns paths directly).
  const toolPaths = await extractExternalTools();
  if (!toolPaths) {
    throw new Error(
      `failed to extract ${tool} from VFS (extractExternalTools returned null); the embedded tool archive may be corrupt — rebuild the SEA binary`,
    );
  }

  // Get tool path.
  const toolPath = toolPaths[tool];

  if (!toolPath) {
    throw new Error(
      `VFS extraction succeeded but ${tool} was not in the output map (got: ${joinAnd(Object.keys(toolPaths)) || "empty"}); the SEA bundle is missing ${tool} — rebuild with it included`,
    );
  }

  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as DlxOptions;

  // Spawn tool directly.
  const spawnPromise = spawn(toolPath, args, {
    ...dlxOptions,
    env: {
      ...process.env,
      ...spawnEnv,
    },
    stdio: (spawnExtra?.["stdio"] as StdioOptions | undefined) ?? "inherit",
  });

  return {
    spawnPromise,
  };
}

/**
 * Validate package name to prevent command injection. Package names must follow
 * npm naming rules.
 */
export function validatePackageName(name: string): void {
  // Basic validation: no shell metacharacters, must be valid npm package name.
  // npm package names can contain: lowercase letters, numbers, hyphens, underscores, dots, and @ for scopes.
  const validNamePattern = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

  if (!validNamePattern.test(name)) {
    throw new InputError(
      `package name "${name}" must match /^(@scope\\/)?[a-z0-9-~][a-z0-9-._~]*$/ (lowercase letters, digits, -, _, ., ~, with optional @scope/); rename the package or check for typos`,
    );
  }

  // Check for path traversal attempts.
  if (name.includes("..") || (name.includes("/") && !name.startsWith("@"))) {
    throw new InputError(
      `package name "${name}" contains path traversal characters (".." or a "/" outside of @scope/); pass a plain name like "lodash" or "@org/pkg"`,
    );
  }
}

export { spawnSfwVfs } from "./spawn-sfw.mts";

export { spawnCdxgenVfs } from "./spawn-cdxgen.mts";

export { spawnCoanaVfs } from "./spawn-coana.mts";

export { spawnSocketPatchVfs } from "./spawn-socket-patch.mts";

/**
 * High-level spawn functions that auto-detect SEA vs npm CLI mode. These choose
 * between VFS extraction (SEA) and dlx download (npm CLI).
 */

export { spawnSfw } from "./spawn-sfw.mts";

export { spawnCdxgen } from "./spawn-cdxgen.mts";

export { spawnCoana } from "./spawn-coana.mts";

export { spawnSocketPatch } from "./spawn-socket-patch.mts";

export { spawnSynp, spawnSynpDlx, spawnSynpVfs } from "./spawn-synp.mts";

/**
 * Python CLI spawn utilities. Re-exported from spawn-pycli.mts (extracted from
 * spawn.mts to keep this file under the 1000-line File size cap).
 */
export {
  convertCaretToPipRange,
  downloadPyPiWheel,
  downloadPython,
  ensurePython,
  ensurePythonDlx,
  ensureSocketPyCli,
  getPythonBinPath,
  getPythonCachePath,
  getPythonStandaloneInfo,
  isSocketPyCliInstalled,
  spawnSocketPyCli,
  spawnSocketPyCliDlx,
  spawnSocketPyCliVfs,
} from "./spawn-pycli.mts";

export type { SocketPyCliDlxOptions } from "./spawn-pycli.mts";

/**
 * Security scanning tool spawn utilities. These tools are used by socket-basics
 * for comprehensive scanning. In SEA mode, they're extracted from VFS. In npm
 * CLI mode, they're downloaded from GitHub.
 */

export { spawnTrivy, spawnTrivyDlx, spawnTrivyVfs } from "./spawn-trivy.mts";

/**
 * Spawn TruffleHog via GitHub download (npm CLI mode). Downloads from GitHub
 * releases (trufflesecurity/trufflehog).
 */
export { spawnTrufflehog, spawnTrufflehogDlx, spawnTrufflehogVfs } from "./spawn-trufflehog.mts";

export { spawnOpengrep, spawnOpengrepDlx, spawnOpengrepVfs } from "./spawn-opengrep.mts";
