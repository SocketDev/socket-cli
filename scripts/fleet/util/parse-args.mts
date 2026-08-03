/**
 * @file Simplified argument parsing for build scripts. Uses Node.js built-in
 *   util.parseArgs (available in Node 22+). This is intentionally separate from
 *   src/argv/parse.ts to avoid circular dependencies where build scripts depend
 *   on the built dist output.
 */

import process from 'node:process'
import { parseArgs as nodeParseArgs } from 'node:util'

import type { ParseArgsConfig } from 'node:util'

interface ParseArgsResult {
  values: Record<string, unknown>
  positionals: string[]
}

/**
 * Extract positional arguments from process.argv.
 */
export function getPositionalArgs(startIndex: number = 2): string[] {
  const args = process.argv.slice(startIndex)
  const positionals: string[] = []

  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    // Stop at first flag
    if (arg.startsWith('-')) {
      break
    }
    positionals.push(arg)
  }

  return positionals
}

/**
 * Check if a specific flag is present in argv.
 */
export function hasFlag(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(`--${flag}`) || argv.includes(`-${flag.charAt(0)}`)
}

/**
 * Parse command-line arguments using Node.js built-in parseArgs. Simplified
 * version for build scripts that don't need yargs-parser features.
 */
export function parseArgs(
  options: Partial<ParseArgsConfig> = {},
): ParseArgsResult {
  const {
    allowPositionals = true,
    args = process.argv.slice(2),
    options: parseOptions = {},
    strict = false,
  } = options

  try {
    const result = nodeParseArgs({
      args,
      options: parseOptions,
      strict,
      allowPositionals,
    })

    return {
      values: result.values,
      positionals: result.positionals || [],
    }
  } catch (e) {
    // If parsing fails in non-strict mode, return empty values
    if (!strict) {
      return {
        values: {},
        positionals: args.filter(arg => !arg.startsWith('-')),
      }
    }
    throw e
  }
}
