/**
 * @fileoverview Simplified argument parsing for build scripts.
 * Uses Node.js built-in util.parseArgs (available in Node 22+).
 *
 * This is intentionally separate from src/argv/parse.ts to avoid circular
 * dependencies where build scripts depend on the built dist output.
 */

import { parseArgs as nodeParseArgs } from 'node:util'

/**
 * Parse command-line arguments using Node.js built-in parseArgs.
 * Simplified version for build scripts that don't need yargs-parser features.
 *
 * @param {object} config - Parse configuration
 * @param {string[]} [config.args] - Arguments to parse (defaults to process.argv.slice(2))
 * @param {object} [config.options] - Options configuration
 * @param {boolean} [config.strict] - Whether to throw on unknown options (default: false)
 * @param {boolean} [config.allowPositionals] - Whether to allow positionals (default: true)
 * @returns {{ values: object, positionals: string[] }}
 */
export function parseArgs(config = {}) {
  const {
    allowPositionals = true,
    args = process.argv.slice(2),
    options = {},
    strict = false,
  } = config

  try {
    const result = nodeParseArgs({
      args,
      options,
      strict,
      allowPositionals,
    })

    return {
      values: result.values,
      positionals: result.positionals || [],
    }
  } catch (error) {
    // If parsing fails in non-strict mode, return empty values
    if (!strict) {
      return {
        values: {},
        positionals: args.filter(arg => !arg.startsWith('-')),
      }
    }
    throw error
  }
}

/**
 * Extract positional arguments from process.argv.
 *
 * @param {number} [startIndex=2] - Index to start from
 * @returns {string[]}
 */
export function getPositionalArgs(startIndex = 2) {
  const args = process.argv.slice(startIndex)
  const positionals = []

  for (const arg of args) {
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
 *
 * @param {string} flag - Flag name (without dashes)
 * @param {string[]} [argv=process.argv] - Arguments array
 * @returns {boolean}
 */
export function hasFlag(flag, argv = process.argv) {
  return argv.includes(`--${flag}`) || argv.includes(`-${flag.charAt(0)}`)
}
