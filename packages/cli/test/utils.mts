import path from "node:path";
import { fileURLToPath } from "node:url";

import { it } from "vitest";

import { createEnvProxy } from "@socketsecurity/lib-stable/env/proxy";
import { spawn } from "@socketsecurity/lib-stable/process/spawn/child";
import { stripAnsi } from "@socketsecurity/lib-stable/ansi/strip";

import type { SpawnOptions } from "@socketsecurity/lib-stable/process/spawn/types";

import { scrubSnapshotData } from "./util/scrub-snapshot-data.mts";
import { execPath } from "../src/constants/paths.mts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set VITEST environment variable for test runs.
// This disables interactive help menus in spawned CLI processes.
// Must be set on process.env directly (not spread) to preserve
// Windows environment variable proxy behavior.
if (!process.env["VITEST"]) {
  process.env["VITEST"] = "1";
}

// Backward compatibility object for tests.
// In VITEST mode, use a Proxy to keep env vars live and handle case-sensitivity.
const constants = {
  execPath,
  processEnv: process.env["VITEST"] ? createEnvProxy(process.env) : process.env,
};

// The asciiUnsafeRegexp match characters that are:
//   * Control characters in the Unicode range:
//     - \u0000 to \u0007 (e.g., NUL, BEL)
//     - \u0009 (Tab, but note: not \u0008 Backspace or \u000A Newline)
//     - \u000B to \u001F (other non-printable control characters)
//   * All non-ASCII characters:
//     - \u0080 to \uFFFF (extended Unicode)

const asciiUnsafeRegexp = /[\u0000-\u0007\u0009\u000b-\u001f\u0080-\uffff]/g;

// Note: The fixture directory is in the same directory as this utils file.
export const testPath = __dirname;

function normalizeLogSymbols(str: string): string {
  return str.replaceAll("✖", "×").replaceAll("ℹ", "i").replaceAll("✔", "√").replaceAll("⚠", "‼");
}

function normalizeNewlines(str: string): string {
  return (
    str
      // Replace all literal \r\n.
      .replaceAll("\r\n", "\n")
      // Replace all escaped \\r\\n.
      .replaceAll("\\r\\n", "\\n")
  );
}

function stripZeroWidthSpace(str: string): string {
  return str.replaceAll("\u200b", "");
}

function toAsciiSafeString(str: string): string {
  return str.replace(asciiUnsafeRegexp, (m) => {
    const code = m.charCodeAt(0);
    return code < 255
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

function stripTokenErrorMessages(str: string): string {
  // Remove API token error messages to avoid snapshot inconsistencies
  // when local environment has/doesn't have tokens set.
  return str.replace(/^\s*[×✖]\s+This command requires a Socket API token for access.*$/gm, "");
}

function sanitizeTokens(str: string): string {
  // Sanitize Socket API tokens to prevent leaking credentials into snapshots.
  // Socket tokens follow the format: sktsec_[alphanumeric+underscore characters]

  // Match Socket API tokens: sktsec_ followed by word characters
  const tokenPattern = /sktsec_\w+/g;
  let result = str.replace(tokenPattern, "sktsec_REDACTED_TOKEN");

  // Sanitize token values in JSON-like structures
  result = result.replace(/"apiToken"\s*:\s*"sktsec_[^"]+"/g, '"apiToken":"sktsec_REDACTED_TOKEN"');

  // Sanitize token prefixes that might be displayed (e.g., "zP416" -> "REDAC")
  // Match 5-character alphanumeric strings that appear after "token:" labels
  result = result.replace(/token:\s*\[?\d+m\]?(?:[A-Za-z0-9]{5})\*{3}/gi, "token: REDAC***");

  return result;
}

export function cleanOutput(output: string): string {
  return scrubSnapshotData(
    toAsciiSafeString(
      normalizeLogSymbols(
        normalizeNewlines(
          stripZeroWidthSpace(sanitizeTokens(stripTokenErrorMessages(stripAnsi(output.trim())))),
        ),
      ),
    ),
  );
}

type TestCollectorOptions = Exclude<Parameters<typeof it>[1], undefined>;

/**
 * This is a simple template wrapper for this pattern: `it('should do: socket
 * scan', (['socket', 'scan']) => {})`
 */
export function cmdit(
  cmd: string[],
  title: string,
  cb: (cmd: string[]) => Promise<void>,
  options?: TestCollectorOptions | undefined,
) {
  it(
    `${title}: \`${cmd.join(" ")}\``,
    {
      timeout: 30_000,
      ...options,
    },
    cb.bind(undefined, cmd),
  );
}

export async function spawnSocketCli(
  entryPath: string,
  args: string[],
  options?: SpawnOptions | undefined,
): Promise<{
  code: number;
  error?:
    | {
        message: string;
        stack: string;
      }
    | undefined;
  status: boolean;
  stdout: string;
  stderr: string;
}> {
  const {
    cwd = process.cwd(),
    env: spawnEnv,
    ...restOptions
  } = {
    __proto__: null,
    ...options,
  } as SpawnOptions;

  // Detect if entryPath is a standalone binary (not a JS file).
  // Binaries include: yao-pkg, SEA, or any executable without JS extension.
  const isJsFile =
    entryPath.endsWith(".js") ||
    entryPath.endsWith(".mjs") ||
    entryPath.endsWith(".cjs") ||
    entryPath.endsWith(".mts") ||
    entryPath.endsWith(".ts");

  // For binaries, execute directly. For JS files, run through Node.
  const command = isJsFile ? constants.execPath : entryPath;
  const commandArgs = isJsFile ? [entryPath, ...args] : args;

  try {
    // Create a Proxy env that handles Windows case-insensitivity issues.
    // This ensures PATH, TEMP, and other Windows env vars work regardless
    // of case (PATH vs Path vs path).
    const env = createEnvProxy(
      constants.processEnv,
      spawnEnv as Record<string, string | undefined>,
    );

    const output = await spawn(command, commandArgs, {
      cwd,
      env,
      ...restOptions,
      // Close stdin to prevent tests from hanging
      // when commands wait for input. Must be after restOptions
      // to ensure it's not overridden.
      stdio: restOptions.stdio ?? ["ignore", "pipe", "pipe"],
    });
    return {
      status: true,
      code: 0,
      stdout: cleanOutput(
        typeof output.stdout === "string" ? output.stdout : output.stdout.toString(),
      ),
      stderr: cleanOutput(
        typeof output.stderr === "string" ? output.stderr : output.stderr.toString(),
      ),
    };
  } catch (e: unknown) {
    const error = e as {
      code?: number | undefined;
      message?: string | undefined;
      stack?: string | undefined;
      stdout?: Buffer | string | undefined;
      stderr?: Buffer | string | undefined;
    };
    return {
      status: false,
      code: typeof error.code === "number" ? error.code : 1,
      error: {
        message: error.message || "",
        stack: error.stack || "",
      },
      stdout: cleanOutput(
        typeof error.stdout === "string" ? error.stdout : error.stdout?.toString() || "",
      ),
      stderr: cleanOutput(
        typeof error.stderr === "string" ? error.stderr : error.stderr?.toString() || "",
      ),
    };
  }
}
