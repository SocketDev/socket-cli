import os from 'node:os'

import ENV from './constants/env.mts'
import meow from './meow.mts'

import type { MeowFlag as Flag } from './meow.mts'

// Meow doesn't expose this.
export type AnyFlag = StringFlag | BooleanFlag | NumberFlag

export type BooleanFlag = Flag & { type: 'boolean' }

export type NumberFlag = Flag & { type: 'number' }

export type StringFlag = Flag & { type: 'string' }

export type MeowFlag = AnyFlag & {
  description: string
  hidden?: boolean | undefined
}

// We use this description in getFlagListOutput, meow doesn't care.
export type MeowFlags = Record<string, MeowFlag>

type RawSpaceSizeFlags = {
  maxOldSpaceSize: number
  maxSemiSpaceSize: number
}

let _rawSpaceSizeFlags: RawSpaceSizeFlags | undefined

/**
 * Reset cached flag values for testing purposes.
 * @internal
 */
export function resetFlagCache(): void {
  _rawSpaceSizeFlags = undefined
  _maxOldSpaceSizeFlag = undefined
  _maxSemiSpaceSizeFlag = undefined
}

function getRawSpaceSizeFlags(): RawSpaceSizeFlags {
  if (_rawSpaceSizeFlags === undefined) {
    const cli = meow({
      argv: process.argv.slice(2),
      // Prevent meow from potentially exiting early.
      autoHelp: false,
      autoVersion: false,
      flags: {
        maxOldSpaceSize: {
          type: 'number',
          default: 0,
        },
        maxSemiSpaceSize: {
          type: 'number',
          default: 0,
        },
      },
      importMeta: { url: import.meta.url } as ImportMeta,
    })
    _rawSpaceSizeFlags = {
      maxOldSpaceSize: Number(cli.flags['maxOldSpaceSize']),
      maxSemiSpaceSize: Number(cli.flags['maxSemiSpaceSize']),
    }
  }
  return _rawSpaceSizeFlags!
}

let _maxOldSpaceSizeFlag: number | undefined
export function getMaxOldSpaceSizeFlag(): number {
  if (_maxOldSpaceSizeFlag === undefined) {
    _maxOldSpaceSizeFlag = getRawSpaceSizeFlags().maxOldSpaceSize
    if (!_maxOldSpaceSizeFlag) {
      const match = /(?<=--max-old-space-size=)\d+/.exec(
        ENV.NODE_OPTIONS || '',
      )?.[0]
      _maxOldSpaceSizeFlag = match ? Number(match) : 0
    }
    if (!_maxOldSpaceSizeFlag) {
      // Default value determined by available system memory.
      _maxOldSpaceSizeFlag = Math.floor(
        // Total system memory in MiB.
        (os.totalmem() / 1_024 / 1_024) *
          // Set 75% of total memory (safe buffer to avoid system pressure).
          0.75,
      )
    }
  }
  return _maxOldSpaceSizeFlag
}
// Ensure export because dist/flags.js is required in src/constants.mts.
// eslint-disable-next-line n/exports-style
if (typeof exports === 'object' && exports !== null) {
  // eslint-disable-next-line n/exports-style
  exports.getMaxOldSpaceSizeFlag = getMaxOldSpaceSizeFlag
}

let _maxSemiSpaceSizeFlag: number | undefined
export function getMaxSemiSpaceSizeFlag(): number {
  if (_maxSemiSpaceSizeFlag === undefined) {
    _maxSemiSpaceSizeFlag = getRawSpaceSizeFlags().maxSemiSpaceSize
    if (!_maxSemiSpaceSizeFlag) {
      const match = /(?<=--max-semi-space-size=)\d+/.exec(
        ENV.NODE_OPTIONS || '',
      )?.[0]
      _maxSemiSpaceSizeFlag = match ? Number(match) : 0
    }
    if (!_maxSemiSpaceSizeFlag) {
      const maxOldSpaceSize = getMaxOldSpaceSizeFlag()
      // Dynamically scale semi-space size based on max-old-space-size.
      // https://nodejs.org/api/cli.html#--max-semi-space-sizesize-in-mib
      if (maxOldSpaceSize <= 8_192) {
        // Use tiered values for smaller heaps to avoid excessive young
        // generation size. This helps stay within safe memory limits on
        // constrained systems or CI.
        if (maxOldSpaceSize <= 512) {
          _maxSemiSpaceSizeFlag = 4
        } else if (maxOldSpaceSize <= 1_024) {
          _maxSemiSpaceSizeFlag = 8
        } else if (maxOldSpaceSize <= 2_048) {
          _maxSemiSpaceSizeFlag = 16
        } else if (maxOldSpaceSize <= 4_096) {
          _maxSemiSpaceSizeFlag = 32
        } else {
          _maxSemiSpaceSizeFlag = 64
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
        const log2OldSpace = Math.log2(maxOldSpaceSize)
        const scaledSemiSpace = Math.floor(log2OldSpace) * 8
        _maxSemiSpaceSizeFlag = scaledSemiSpace
      }
    }
  }
  return _maxSemiSpaceSizeFlag
}
// Ensure export because dist/flags.js is required in src/constants.mts.
// eslint-disable-next-line n/exports-style
if (typeof exports === 'object' && exports !== null) {
  // eslint-disable-next-line n/exports-style
  exports.getMaxSemiSpaceSizeFlag = getMaxSemiSpaceSizeFlag
}

export const commonFlags: MeowFlags = {
  animateHeader: {
    type: 'boolean',
    default: true,
    description: 'Disable animated header shimmer effect',
    // Hidden to allow custom documenting of the negated `--no-animate-header` variant.
    hidden: true,
  },
  banner: {
    type: 'boolean',
    default: true,
    description: 'Hide the Socket banner',
    // Hidden to allow custom documenting of the negated `--no-banner` variant.
    hidden: true,
  },
  compactHeader: {
    type: 'boolean',
    default: false,
    description: 'Use compact single-line header format (auto-enabled in CI)',
    // Only show in root command.
    hidden: true,
  },
  headerTheme: {
    type: 'string',
    default: 'default',
    description:
      'Header color theme (default, cyberpunk, forest, ocean, sunset)',
    hidden: true,
  },
  config: {
    type: 'string',
    default: '',
    description: 'Override the local config with this JSON',
    shortFlag: 'c',
    // Only show in root command.
    hidden: true,
  },
  dryRun: {
    type: 'boolean',
    default: false,
    description: 'Run without uploading',
    // Only show in root command.
    hidden: true,
  },
  help: {
    type: 'boolean',
    default: false,
    description: 'Show help',
    shortFlag: 'h',
    // Only show in root command.
    hidden: true,
  },
  helpFull: {
    type: 'boolean',
    default: false,
    description: 'Show full help including environment variables',
    // Only show in root command.
    hidden: true,
  },
  maxOldSpaceSize: {
    type: 'number',
    get default() {
      return getMaxOldSpaceSizeFlag()
    },
    description: 'Set Node.js memory limit',
    // Only show in root command in debug mode.
    hidden: true,
  },
  maxSemiSpaceSize: {
    type: 'number',
    get default() {
      return getMaxSemiSpaceSizeFlag()
    },
    description: 'Set Node.js heap size',
    // Only show in root command in debug mode.
    hidden: true,
  },
  spinner: {
    type: 'boolean',
    default: true,
    description: 'Hide the console spinner',
    // Hidden to allow custom documenting of the negated `--no-spinner` variant.
    hidden: true,
  },
}

export const outputFlags: MeowFlags = {
  json: {
    type: 'boolean',
    default: false,
    description: 'Output as JSON',
    shortFlag: 'j',
  },
  markdown: {
    type: 'boolean',
    default: false,
    description: 'Output as Markdown',
    shortFlag: 'm',
  },
}

export const validationFlags: MeowFlags = {
  all: {
    type: 'boolean',
    default: false,
    description: 'Include all issues',
  },
  strict: {
    type: 'boolean',
    default: false,
    description: 'Exits with an error code if any matching issues are found',
  },
}
