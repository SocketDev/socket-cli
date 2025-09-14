import { camelToKebab } from './strings.mts'

const CONFIG_FLAG_NAME = 'config'
const CONFIG_FLAG_LONG_NAME = `--${CONFIG_FLAG_NAME}`
const CONFIG_FLAG_ASSIGNMENT = `${CONFIG_FLAG_LONG_NAME}=`
const CONFIG_FLAG_ASSIGNMENT_LENGTH = CONFIG_FLAG_ASSIGNMENT.length

const configFlags = new Set(['--config'])
const helpFlags = new Set(['--help', '-h'])

/**
 * Convert command arguments to a properly formatted string representation.
 */
export function cmdFlagsToString(args: string[] | readonly string[]): string {
  const result = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!.trim()
    if (arg.startsWith('--')) {
      const nextArg = i + 1 < length ? args[i + 1]!.trim() : undefined
      // Check if the next item exists and is NOT another flag.
      if (nextArg?.startsWith('--')) {
        result.push(`${arg}=${nextArg}`)
        i += 1
      } else {
        result.push(arg)
      }
    }
  }
  return result.join(' ')
}

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
    const arg = argv[i]!.trim()
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
