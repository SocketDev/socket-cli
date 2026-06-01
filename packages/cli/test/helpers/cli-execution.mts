/* max-file-lines: legitimate — comprehensive CLI execution test harness; splitting would scatter tightly coupled spawn / assertion / sandbox helpers. */
/**
 * @file CLI execution test helpers for Socket CLI. Provides high-level
 *   utilities for executing CLI commands with comprehensive output validation
 *   and assertion capabilities.
 */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { safeDelete } from "@socketsecurity/lib-stable/fs/safe";

import { constants } from "../../src/constants.mts";
import { spawnSocketCli } from "../utils.mts";

import type { SpawnOptions } from "@socketsecurity/lib-stable/process/spawn/types";

/**
 * Result from CLI execution with enhanced utilities.
 */
interface CliExecutionResult {
  /**
   * Exit code from the CLI command.
   */
  code: number;
  /**
   * Whether the command succeeded (code === 0)
   */
  status: boolean;
  /**
   * Cleaned stdout output.
   */
  stdout: string;
  /**
   * Cleaned stderr output.
   */
  stderr: string;
  /**
   * Combined stdout and stderr.
   */
  output: string;
  /**
   * Error details if command failed.
   */
  error?:
    | {
        message: string;
        stack: string;
      }
    | undefined;
}

/**
 * Options for CLI execution.
 */
interface CliExecutionOptions extends SpawnOptions {
  /**
   * Whether to automatically add --config {} to isolate from user config
   * (default: true)
   */
  isolateConfig?: boolean | undefined;
  /**
   * Custom config object to pass with --config flag.
   */
  config?: Record<string, unknown> | undefined;
  /**
   * Expect the command to fail with specific exit code.
   */
  expectedExitCode?: number | undefined;
  /**
   * Timeout in milliseconds (default: 30000)
   */
  timeout?: number | undefined;
}

/**
 * Execute Socket CLI command with enhanced result handling.
 *
 * @example
 *   ;```typescript
 *   const result = await executeCliCommand(['scan', '--json'], {
 *     isolateConfig: true,
 *   })
 *   expect(result.status).toBe(true)
 *   expect(result.stdout).toContain('scan-id')
 *   ```
 *
 * @param args - Command arguments to pass to Socket CLI.
 * @param options - Execution options.
 *
 * @returns Enhanced CLI execution result
 */
export async function executeCliCommand(
  args: string[],
  options?: CliExecutionOptions | undefined,
): Promise<CliExecutionResult> {
  const {
    config,
    expectedExitCode,
    isolateConfig = true,
    timeout = 30_000,
    ...spawnOptions
  } = {
    __proto__: null,
    ...options,
  } as CliExecutionOptions;

  const binCliPath = constants.getBinCliPath();
  const finalArgs = [...args];

  // Add config isolation if requested
  if (isolateConfig && !args.includes("--config")) {
    if (config) {
      finalArgs.push("--config", JSON.stringify(config));
    } else {
      finalArgs.push("--config", "{}");
    }
  }

  const result = await spawnSocketCli(binCliPath, finalArgs, {
    timeout,
    ...spawnOptions,
  });

  // Check expected exit code if provided
  if (expectedExitCode !== undefined && result.code !== expectedExitCode) {
    throw new Error(
      `Expected exit code ${expectedExitCode} but got ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  return {
    code: result.code,
    ...(result.error && { error: result.error }),
    output: `${result.stdout}\n${result.stderr}`.trim(),
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/**
 * Shape of the Socket CLI's `--json` response contract. Mirrors the
 * `validate_json` shell helper that was in `test/smoke.sh` so e2e tests can
 * assert the contract programmatically.
 *
 * The contract:
 *
 * - `ok: true` payloads MUST include a non-null `data` field. `message` is
 *   optional, `cause`/`code` are absent.
 * - `ok: false` payloads MUST include a non-empty `message` string. `data` is
 *   optional; `cause`/`code` are optional but, when `code` is present, it must
 *   be a number.
 */
interface SocketJsonOk<T = unknown> {
  ok: true;
  data: T;
  message?: string | undefined;
}
interface SocketJsonErr {
  ok: false;
  data?: unknown | undefined;
  message: string;
  cause?: string | undefined;
  code?: number | undefined;
}
type SocketJsonContract<T = unknown> = SocketJsonOk<T> | SocketJsonErr;

/**
 * Validate that `stdout` is JSON matching the Socket CLI's `--json` contract,
 * given the `expectedExitCode` the command actually returned. Returns the
 * parsed payload on success; throws with a diagnostic message on contract
 * violation.
 *
 * The contract being asserted is the same one `test/smoke.sh::validate_json`
 * enforced before being ported to TypeScript.
 *
 * @example
 *   const result = await executeCliCommand(['scan', 'list', '--json'])
 *   const payload = validateSocketJsonContract(result.stdout, 0)
 *   expect(payload.ok).toBe(true)
 */
export function validateSocketJsonContract<T = unknown>(
  stdout: string,
  expectedExitCode: number,
): SocketJsonContract<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (e) {
    throw new Error(
      `Socket JSON contract violation: command output is not valid JSON (${(e as Error).message}); stdout may contain progress text mixed with the payload.\nstdout: ${stdout}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Socket JSON contract violation: payload is not an object.\nstdout: ${stdout}`);
  }
  const obj = parsed as Record<string, unknown>;
  const ok = obj["ok"];
  if (typeof ok !== "boolean") {
    throw new Error(
      `Socket JSON contract violation: "ok" must be a boolean (got ${typeof ok}).\nstdout: ${stdout}`,
    );
  }
  if (expectedExitCode === 0 && ok !== true) {
    throw new Error(
      `Socket JSON contract violation: exit code 0 but "ok" is ${ok} (expected true).\nstdout: ${stdout}`,
    );
  }
  if (expectedExitCode !== 0 && ok !== false) {
    throw new Error(
      `Socket JSON contract violation: exit code ${expectedExitCode} but "ok" is ${ok} (expected false).\nstdout: ${stdout}`,
    );
  }
  if (ok === true && (obj["data"] === undefined || obj["data"] === null)) {
    throw new Error(
      `Socket JSON contract violation: ok:true must include a non-null "data" field (return an empty object/array if no payload).\nstdout: ${stdout}`,
    );
  }
  if (ok === false) {
    const message = obj["message"];
    if (typeof message !== "string" || message.length === 0) {
      throw new Error(
        `Socket JSON contract violation: ok:false must include a non-empty "message" string.\nstdout: ${stdout}`,
      );
    }
  }
  if (obj["code"] !== undefined && typeof obj["code"] !== "number") {
    throw new Error(
      `Socket JSON contract violation: "code" must be a number when present (got ${typeof obj["code"]}).\nstdout: ${stdout}`,
    );
  }
  return obj as unknown as SocketJsonContract<T>;
}

/**
 * Options for {@link executeCliInScratch}.
 */
interface CliInScratchOptions extends CliExecutionOptions {
  /**
   * Files to seed into the scratch cwd before running. Keyed by relative path;
   * each value is the file body written verbatim. Use for fixtures the
   * command-under-test needs to read.
   */
  seedFiles?: Record<string, string> | undefined;
}

/**
 * Execute Socket CLI inside a fully isolated scratch directory. Pins
 * **everything** the CLI or its spawned subprocesses might read or write
 * outside of cwd into the scratch tree, so an e2e run never touches the
 * developer's system:
 *
 * - `cwd` → fresh `os.os.tmpdir()/socket-e2e-<n>/`
 * - `HOME` / `USERPROFILE` → fresh `os.os.tmpdir()/socket-e2e-home-<n>/`
 * - `XDG_CONFIG_HOME` → `<scratchHome>/.config`
 * - `XDG_CACHE_HOME` → `<scratchHome>/.cache`
 * - `XDG_DATA_HOME` → `<scratchHome>/.local/share`
 * - `XDG_STATE_HOME` → `<scratchHome>/.local/state`
 * - `NPM_CONFIG_CACHE` / `npm_config_cache` → `<scratchHome>/.npm`
 * - `NPM_CONFIG_PREFIX` / `npm_config_prefix` → `<scratchHome>/.npm-global`
 * - `NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` → `<scratchHome>/.npmrc`
 * - `PNPM_HOME` → `<scratchHome>/.pnpm`
 * - `YARN_CACHE_FOLDER` → `<scratchHome>/.yarn-cache`
 * - `PIP_CACHE_DIR` → `<scratchHome>/.pip-cache`
 * - `CARGO_HOME` → `<scratchHome>/.cargo`
 * - `GRADLE_USER_HOME` → `<scratchHome>/.gradle`
 *
 * Anything not pinned by the helper (the developer's `SOCKET_API_KEY` env, the
 * real OS keychain for credentials) is **read-only** from the CLI's perspective
 * — the CLI may read the token but the scratch HOME ensures it can't persist a
 * new one back into the dev's config.
 *
 * Cleans up the scratch trees via `safeDelete()` even on failure.
 *
 * @example
 *   const result = await executeCliInScratch(['scan', 'create', '.'], {
 *     seedFiles: { 'package.json': '{"name":"test","version":"0.0.0"}' },
 *   })
 *   expect(result.code).toBe(0)
 */
export async function executeCliInScratch(
  args: string[],
  options?: CliInScratchOptions | undefined,
): Promise<CliExecutionResult> {
  const {
    seedFiles,
    env: callerEnv,
    cwd: callerCwd,
    ...rest
  } = {
    __proto__: null,
    ...options,
  } as CliInScratchOptions;

  const scratchCwd = mkdtempSync(path.join(os.tmpdir(), "socket-e2e-"));
  const scratchHome = mkdtempSync(path.join(os.tmpdir(), "socket-e2e-home-"));
  try {
    if (seedFiles) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      for (const [relPath, body] of Object.entries(seedFiles)) {
        const full = path.join(scratchCwd, relPath);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, body);
      }
    }
    return await executeCliCommand(args, {
      ...rest,
      cwd: callerCwd ?? scratchCwd,
      env: {
        ...process.env,
        // Home dir pins.
        HOME: scratchHome,
        USERPROFILE: scratchHome,
        // XDG base-directory spec.
        XDG_CONFIG_HOME: path.join(scratchHome, ".config"),
        // oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- per-test scratch HOME isolation: the cache must sit under the sandboxed HOME, not the repo root, so tests don't write to the real ~/.cache.
        XDG_CACHE_HOME: path.join(scratchHome, ".cache"),
        XDG_DATA_HOME: path.join(scratchHome, ".local", "share"),
        XDG_STATE_HOME: path.join(scratchHome, ".local", "state"),
        // npm / npx pins. Both the lowercase `npm_config_*` and uppercase
        // `NPM_CONFIG_*` forms are honored by npm; set both so neither
        // wins from process.env spillover.
        npm_config_cache: path.join(scratchHome, ".npm"),
        NPM_CONFIG_CACHE: path.join(scratchHome, ".npm"),
        npm_config_prefix: path.join(scratchHome, ".npm-global"),
        NPM_CONFIG_PREFIX: path.join(scratchHome, ".npm-global"),
        npm_config_userconfig: path.join(scratchHome, ".npmrc"),
        NPM_CONFIG_USERCONFIG: path.join(scratchHome, ".npmrc"),
        // Sibling package managers.
        PNPM_HOME: path.join(scratchHome, ".pnpm"),
        YARN_CACHE_FOLDER: path.join(scratchHome, ".yarn-cache"),
        // Non-JS toolchains the manifest generators may invoke.
        PIP_CACHE_DIR: path.join(scratchHome, ".pip-cache"),
        CARGO_HOME: path.join(scratchHome, ".cargo"),
        GRADLE_USER_HOME: path.join(scratchHome, ".gradle"),
        // Caller-supplied env wins.
        ...callerEnv,
      },
    });
  } finally {
    await safeDelete(scratchCwd);
    await safeDelete(scratchHome);
  }
}

/**
 * Run a block with `HOME` / `USERPROFILE` swapped to a fresh scratch tmpdir for
 * the duration of `fn`. Restores the original env on exit and `safeDelete()`s
 * the scratch tree.
 *
 * Use this when an e2e test calls socket-cli internals directly (in-process) —
 * e.g. `spawnDlx()` — rather than spawning the CLI binary. The
 * `executeCliInScratch` helper covers the spawn-the-binary path; this is the
 * sibling for the in-process path.
 *
 * Concurrency note: vitest runs tests within a single file serially by default.
 * Each worker has its own Node process so env mutation here doesn't race
 * against other test files. Don't use this in a file that opts into
 * `it.concurrent`.
 *
 * @example
 *   await withScratchHome(async () => {
 *     const result = await spawnDlx({ name: 'cowsay', version: '1.6.0' }, [
 *       'moo',
 *     ])
 *     expect((await result.spawnPromise).code).toBe(0)
 *   })
 */
export async function withScratchHome<T>(fn: () => Promise<T>): Promise<T> {
  const scratchHome = mkdtempSync(path.join(os.tmpdir(), "socket-e2e-home-"));
  const prevHome = process.env["HOME"];
  const prevUserProfile = process.env["USERPROFILE"];
  const prevXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  const prevXdgCacheHome = process.env["XDG_CACHE_HOME"];
  const prevXdgDataHome = process.env["XDG_DATA_HOME"];
  const prevXdgStateHome = process.env["XDG_STATE_HOME"];
  const prevNpmCache = process.env["npm_config_cache"];
  const prevNpmCacheUpper = process.env["NPM_CONFIG_CACHE"];
  const prevNpmPrefix = process.env["npm_config_prefix"];
  const prevNpmPrefixUpper = process.env["NPM_CONFIG_PREFIX"];
  const prevPnpmHome = process.env["PNPM_HOME"];
  const prevYarnCache = process.env["YARN_CACHE_FOLDER"];
  try {
    process.env["HOME"] = scratchHome;
    process.env["USERPROFILE"] = scratchHome;
    process.env["XDG_CONFIG_HOME"] = path.join(scratchHome, ".config");
    // oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- per-test scratch HOME isolation: the cache must sit under the sandboxed HOME, not the repo root, so tests don't write to the real ~/.cache.
    process.env["XDG_CACHE_HOME"] = path.join(scratchHome, ".cache");
    process.env["XDG_DATA_HOME"] = path.join(scratchHome, ".local", "share");
    process.env["XDG_STATE_HOME"] = path.join(scratchHome, ".local", "state");
    process.env["npm_config_cache"] = path.join(scratchHome, ".npm");
    process.env["NPM_CONFIG_CACHE"] = path.join(scratchHome, ".npm");
    process.env["npm_config_prefix"] = path.join(scratchHome, ".npm-global");
    process.env["NPM_CONFIG_PREFIX"] = path.join(scratchHome, ".npm-global");
    process.env["PNPM_HOME"] = path.join(scratchHome, ".pnpm");
    process.env["YARN_CACHE_FOLDER"] = path.join(scratchHome, ".yarn-cache");
    return await fn();
  } finally {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore("HOME", prevHome);
    restore("USERPROFILE", prevUserProfile);
    restore("XDG_CONFIG_HOME", prevXdgConfigHome);
    restore("XDG_CACHE_HOME", prevXdgCacheHome);
    restore("XDG_DATA_HOME", prevXdgDataHome);
    restore("XDG_STATE_HOME", prevXdgStateHome);
    restore("npm_config_cache", prevNpmCache);
    restore("NPM_CONFIG_CACHE", prevNpmCacheUpper);
    restore("npm_config_prefix", prevNpmPrefix);
    restore("NPM_CONFIG_PREFIX", prevNpmPrefixUpper);
    restore("PNPM_HOME", prevPnpmHome);
    restore("YARN_CACHE_FOLDER", prevYarnCache);
    await safeDelete(scratchHome);
  }
}
