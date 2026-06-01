import os from "node:os";

import { NODE_OPTIONS } from "./env/node-options.mts";
import { defineFlags, meow } from "./meow.mts";

import type { MeowFlag as Flag } from "./meow.mts";

// Meow doesn't expose this.
type AnyFlag = StringFlag | BooleanFlag | NumberFlag;

type BooleanFlag = Flag & { type: "boolean" };

type NumberFlag = Flag & { type: "number" };

type StringFlag = Flag & { type: "string" };

export type MeowFlag = AnyFlag & {
  description: string;
  hidden?: boolean | undefined;
};

// We use this description in getFlagListOutput, meow doesn't care.
export type MeowFlags = Record<string, MeowFlag>;

type RawSpaceSizeFlags = {
  maxOldSpaceSize: number;
  maxSemiSpaceSize: number;
};

let rawSpaceSizeFlags: RawSpaceSizeFlags | undefined;

let maxOldSpaceSizeFlag: number | undefined;

// Ensure export because dist/flags.js is required in src/constants.mts.
if (typeof exports === "object" && exports !== null) {
  exports.getMaxOldSpaceSizeFlag = getMaxOldSpaceSizeFlag;
}

let maxSemiSpaceSizeFlag: number | undefined;

export function getMaxOldSpaceSizeFlag(): number {
  if (maxOldSpaceSizeFlag === undefined) {
    const rawFlag = getRawSpaceSizeFlags().maxOldSpaceSize;
    // Check if flag was explicitly set (> 0).
    if (rawFlag > 0) {
      maxOldSpaceSizeFlag = rawFlag;
    } else {
      const match = /(?<=--max-old-space-size=)\d+/.exec(NODE_OPTIONS ?? "")?.[0];
      if (match) {
        const parsed = Number(match);
        /* c8 ignore start - regex (\d+) guarantees a numeric string; defensive guard */
        if (Number.isNaN(parsed) || parsed < 0) {
          maxOldSpaceSizeFlag = 0;
          /* c8 ignore stop */
        } else {
          maxOldSpaceSizeFlag = parsed;
        }
      }
    }
    // Only apply default if no value was set (null/undefined, not 0).
    if (maxOldSpaceSizeFlag == null) {
      // Default value determined by available system memory.
      maxOldSpaceSizeFlag = Math.floor(
        // Total system memory in MiB.
        (os.totalmem() / 1024 / 1024) *
          // Set 75% of total memory (safe buffer to avoid system pressure).
          0.75,
      );
    }
  }
  return maxOldSpaceSizeFlag;
}

export function getMaxSemiSpaceSizeFlag(): number {
  if (maxSemiSpaceSizeFlag === undefined) {
    maxSemiSpaceSizeFlag = getRawSpaceSizeFlags().maxSemiSpaceSize;
    if (!maxSemiSpaceSizeFlag) {
      const match = /(?<=--max-semi-space-size=)\d+/.exec(NODE_OPTIONS ?? "")?.[0];
      if (match) {
        const parsed = Number(match);
        /* c8 ignore start - regex (\d+) guarantees a numeric string; defensive guard */
        if (Number.isNaN(parsed) || parsed < 0) {
          maxSemiSpaceSizeFlag = 0;
          /* c8 ignore stop */
        } else {
          maxSemiSpaceSizeFlag = parsed;
        }
      } else {
        maxSemiSpaceSizeFlag = 0;
      }
    }
    if (!maxSemiSpaceSizeFlag) {
      const maxOldSpaceSize = getMaxOldSpaceSizeFlag();
      // Dynamically scale semi-space size based on max-old-space-size.
      // https://nodejs.org/api/cli.html#--max-semi-space-sizesize-in-mib
      if (maxOldSpaceSize <= 8192) {
        // Use tiered values for smaller heaps to avoid excessive young
        // generation size. This helps stay within safe memory limits on
        // constrained systems or CI.
        if (maxOldSpaceSize <= 512) {
          maxSemiSpaceSizeFlag = 4;
        } else if (maxOldSpaceSize <= 1024) {
          maxSemiSpaceSizeFlag = 8;
        } else if (maxOldSpaceSize <= 2048) {
          maxSemiSpaceSizeFlag = 16;
        } else if (maxOldSpaceSize <= 4096) {
          maxSemiSpaceSizeFlag = 32;
        } else {
          maxSemiSpaceSizeFlag = 64;
        }
      } else {
        // For large heaps (> 8 GiB), compute semi-space size using a log-scaled
        // function.
        //
        // The idea:
        //   - log2(16_384 MiB) = 14  → semi = 14 * 8 = 112
        //   - log2(32_768 MiB) = 15  → semi = 15 * 8 = 120
        //   - Scales gradually as heap increases, avoiding overly large jumps
        //
        // Each 1 MiB of semi-space adds ~3 MiB to the total young generation
        // (V8 uses 3 spaces). So this keeps semi-space proportional, without
        // over committing.
        //
        // Also note: V8 won’t benefit much from >256 MiB semi-space unless
        // you’re allocating large short-lived objects very frequently
        // (e.g. large arrays, buffers).
        const log2OldSpace = Math.log2(maxOldSpaceSize);
        const scaledSemiSpace = Math.floor(log2OldSpace) * 8;
        maxSemiSpaceSizeFlag = scaledSemiSpace;
      }
    }
  }
  return maxSemiSpaceSizeFlag;
}

export function getRawSpaceSizeFlags(): RawSpaceSizeFlags {
  if (rawSpaceSizeFlags === undefined) {
    const cli = meow({
      argv: process.argv.slice(2),
      // Prevent meow from potentially exiting early.
      autoHelp: false,
      autoVersion: false,
      flags: {
        maxOldSpaceSize: {
          type: "number",
          default: 0,
        },
        maxSemiSpaceSize: {
          type: "number",
          default: 0,
        },
      },
      importMeta: { url: import.meta.url } as ImportMeta,
    });
    const maxOldSpaceSize = Number(cli.flags["maxOldSpaceSize"]);
    const maxSemiSpaceSize = Number(cli.flags["maxSemiSpaceSize"]);

    /* c8 ignore start - meow type='number' guarantees numeric values; these guards are belt-and-suspenders */
    if (Number.isNaN(maxOldSpaceSize) || maxOldSpaceSize < 0) {
      throw new Error(
        `--max-old-space-size must be a non-negative integer in megabytes (saw: "${cli.flags["maxOldSpaceSize"]}"); pass a whole number like --max-old-space-size=4096 for 4GB`,
      );
    }
    if (Number.isNaN(maxSemiSpaceSize) || maxSemiSpaceSize < 0) {
      throw new Error(
        `--max-semi-space-size must be a non-negative integer in megabytes (saw: "${cli.flags["maxSemiSpaceSize"]}"); pass a whole number like --max-semi-space-size=128`,
      );
    }
    /* c8 ignore stop */

    rawSpaceSizeFlags = {
      maxOldSpaceSize,
      maxSemiSpaceSize,
    };
  }
  return rawSpaceSizeFlags!;
}

/**
 * Reset cached flag values. Test-only — the V8 space-size flag getters memoize
 * their first read of process.execArgv + process.env; tests need a way to clear
 * the cache between assertions over different env values.
 *
 * @internal
 */
export function resetFlagCache(): void {
  rawSpaceSizeFlags = undefined;
  maxOldSpaceSizeFlag = undefined;
  maxSemiSpaceSizeFlag = undefined;
}

// Ensure export because dist/flags.js is required in src/constants.mts.
if (typeof exports === "object" && exports !== null) {
  exports.getMaxSemiSpaceSizeFlag = getMaxSemiSpaceSizeFlag;
}

export const commonFlags = defineFlags({
  animateHeader: {
    type: "boolean",
    default: true,
    description: "Disable animated header shimmer effect",
    // Hidden to allow custom documenting of the negated `--no-animate-header` variant.
    hidden: true,
  },
  banner: {
    type: "boolean",
    default: true,
    description: "Hide the Socket banner",
    // Hidden to allow custom documenting of the negated `--no-banner` variant.
    hidden: true,
  },
  compactHeader: {
    type: "boolean",
    default: false,
    description: "Use compact single-line header format (auto-enabled in CI)",
    // Only show in root command.
    hidden: true,
  },
  headerTheme: {
    type: "string",
    default: "default",
    description: "Header color theme (default, cyberpunk, forest, ocean, sunset)",
    hidden: true,
  },
  config: {
    type: "string",
    default: "",
    description: "Override the local config with this JSON",
    shortFlag: "c",
    // Only show in root command.
    hidden: true,
  },
  dryRun: {
    type: "boolean",
    default: false,
    description: "Run without uploading",
    // Only show in root command.
    hidden: true,
  },
  help: {
    type: "boolean",
    default: false,
    description: "Show help",
    shortFlag: "h",
    // Only show in root command.
    hidden: true,
  },
  helpFull: {
    type: "boolean",
    default: false,
    description: "Show full help including environment variables",
    // Only show in root command.
    hidden: true,
  },
  maxOldSpaceSize: {
    type: "number",
    get default() {
      return getMaxOldSpaceSizeFlag();
    },
    description: "Set Node.js memory limit",
    // Only show in root command in debug mode.
    hidden: true,
  },
  maxSemiSpaceSize: {
    type: "number",
    get default() {
      return getMaxSemiSpaceSizeFlag();
    },
    description: "Set Node.js heap size",
    // Only show in root command in debug mode.
    hidden: true,
  },
  quiet: {
    type: "boolean",
    default: false,
    description:
      "Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown.",
  },
  spinner: {
    type: "boolean",
    default: true,
    description: "Hide the console spinner",
    // Hidden to allow custom documenting of the negated `--no-spinner` variant.
    hidden: true,
  },
});

export const outputFlags = defineFlags({
  json: {
    type: "boolean",
    default: false,
    description: "Output as JSON",
    shortFlag: "j",
  },
  markdown: {
    type: "boolean",
    default: false,
    description: "Output as Markdown",
    shortFlag: "m",
  },
});
