/**
 * Command-line utilities for Socket CLI.
 * Handles argument parsing, flag processing, and command formatting.
 *
 * Argument Handling:
 * - Handles both long (--flag) and short (-f) formats
 * - Preserves special characters and escaping
 * - Properly quotes arguments containing spaces
 *
 * Command Names:
 * - commandNameFromCamel: Convert camelCase to kebab-case command names
 * - commandNameFromKebab: Convert kebab-case to camelCase
 *
 * Flag Processing:
 * - cmdFlagsToString: Format arguments for display with proper escaping
 * - cmdPrefixMessage: Generate command prefix message
 * - stripConfigFlags: Remove --config flags from argument list
 * - stripDebugFlags: Remove debug-related flags
 * - stripHelpFlags: Remove help flags (-h, --help)
 */

import { FLAG_CONFIG, FLAG_HELP } from '../../constants/cli.mjs'
import { camelToKebab } from '../data/strings.mts'

const CONFIG_FLAG_LONG_NAME = FLAG_CONFIG
const CONFIG_FLAG_ASSIGNMENT = `${CONFIG_FLAG_LONG_NAME}=`
const CONFIG_FLAG_ASSIGNMENT_LENGTH = CONFIG_FLAG_ASSIGNMENT.length

const configFlags = new Set([FLAG_CONFIG])
const helpFlags = new Set([FLAG_HELP, '-h'])

/**
 * Convert flag values to array format for processing.
 */
export function cmdFlagValueToArray(value: any): string[] {
  if (typeof value === 'string') {
    return value.trim().split(/, */).filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap(cmdFlagValueToArray)
  }
  return []
}

/**
 * Convert command arguments to a properly formatted string representation.
 */
export function cmdFlagsToString(args: string[] | readonly string[]): string {
  const result = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]?.trim()
    if (arg?.startsWith('--')) {
      const nextArg = i + 1 < length ? args[i + 1]?.trim() : undefined
      // Check if the next item exists and is NOT another flag.
      if (nextArg && !nextArg.startsWith('--') && !nextArg.startsWith('-')) {
        result.push(`${arg}=${nextArg}`)
        i += 1
      } else {
        result.push(arg)
      }
    } else if (arg) {
      // Include non-flag arguments (commands, package names, etc.).
      result.push(arg)
    }
  }
  return result.join(' ')
}

/**
 * Add command name prefix to message text.
 */
export function cmdPrefixMessage(cmdName: string, text: string): string {
  const cmdPrefix = cmdName ? `${cmdName}: ` : ''
  return `${cmdPrefix}${text}`
}

/**
 * Filter out Socket flags from argv before passing to subcommands.
 */
export function filterFlags(
  argv: readonly string[],
  flagsToFilter: Record<string, any>,
  exceptions?: string[] | undefined,
): string[] {
  const filtered: string[] = []

  // Build set of flags to filter from the provided flag objects.
  const flagsToFilterSet = new Set<string>()
  const flagsWithValueSet = new Set<string>()

  for (const [flagName, flag] of Object.entries(flagsToFilter)) {
    const longFlag = `--${camelToKebab(flagName)}`
    // Special case for negated booleans.
    if (flagName === 'spinner' || flagName === 'banner') {
      flagsToFilterSet.add(`--no-${flagName}`)
    } else {
      flagsToFilterSet.add(longFlag)
    }
    if (flag?.shortFlag) {
      flagsToFilterSet.add(`-${flag.shortFlag}`)
    }
    // Track flags that take values.
    if (flag.type !== 'boolean') {
      flagsWithValueSet.add(longFlag)
      if (flag?.shortFlag) {
        flagsWithValueSet.add(`-${flag.shortFlag}`)
      }
    }
  }

  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    // Check if this flag should be kept as an exception.
    if (exceptions?.includes(arg)) {
      filtered.push(arg)
      // Handle flags that take values.
      if (flagsWithValueSet.has(arg)) {
        // Include the next argument (the flag value).
        i += 1
        if (i < length) {
          filtered.push(argv[i]!)
        }
      }
    } else if (flagsToFilterSet.has(arg)) {
      // Skip flags that take values.
      if (flagsWithValueSet.has(arg)) {
        // Skip the next argument (the flag value).
        i += 1
      }
      // Skip boolean flags (no additional argument to skip).
    } else if (
      arg &&
      Array.from(flagsWithValueSet).some(flag => arg.startsWith(`${flag}=`))
    ) {
      // Skip --flag=value format for Socket flags unless it's an exception.
      if (exceptions?.some(exc => arg.startsWith(`${exc}=`))) {
        filtered.push(arg)
      }
      // Otherwise skip it.
    } else {
      filtered.push(arg!)
    }
  }
  return filtered
}

/**
 * Extract config flag value from command arguments.
 */
export function getConfigFlag(
  argv: string[] | readonly string[],
): string | undefined {
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]?.trim()
    if (!arg) {
      continue
    }
    // Handle --config=value format.
    if (arg.startsWith(CONFIG_FLAG_ASSIGNMENT)) {
      return arg.slice(CONFIG_FLAG_ASSIGNMENT_LENGTH)
    }
    // Handle --config value format.
    if (arg === CONFIG_FLAG_LONG_NAME && i + 1 < length) {
      return argv[i + 1]
    }
  }
  return undefined
}

/**
 * Check if command is an add command (adds new dependencies).
 * Supported by: pnpm, yarn.
 * Note: npm uses 'install' with package names instead of 'add'.
 */
export function isAddCommand(command: string): boolean {
  return command === 'add'
}

/**
 * Check if argument is a config flag.
 */
export function isConfigFlag(cmdArg: string): boolean {
  return configFlags.has(cmdArg) || cmdArg.startsWith(CONFIG_FLAG_ASSIGNMENT)
}

/**
 * Check if argument is a help flag.
 */
export function isHelpFlag(cmdArg: string): boolean {
  return helpFlags.has(cmdArg)
}

/**
 * Check if npm command requires lockfile scanning.
 * npm uses: install, i, update
 */
export function isNpmLockfileScanCommand(command: string): boolean {
  return command === 'install' || command === 'i' || command === 'update'
}

/**
 * Check if pnpm command requires lockfile scanning.
 * pnpm uses: install, i, update, up
 */
export function isPnpmLockfileScanCommand(command: string): boolean {
  return (
    command === 'install' ||
    command === 'i' ||
    command === 'update' ||
    command === 'up'
  )
}

/**
 * Check if yarn command requires lockfile scanning.
 * yarn uses: install, up, upgrade, upgrade-interactive
 */
export function isYarnLockfileScanCommand(command: string): boolean {
  return (
    command === 'install' ||
    command === 'up' ||
    command === 'upgrade' ||
    command === 'upgrade-interactive'
  )
}
