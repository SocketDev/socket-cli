const CONFIG_FLAG_NAME = 'config'
const CONFIG_FLAG_LONG_NAME = `--${CONFIG_FLAG_NAME}`
const CONFIG_FLAG_ASSIGNMENT = `${CONFIG_FLAG_LONG_NAME}=`
const CONFIG_FLAG_ASSIGNMENT_LENGTH = CONFIG_FLAG_ASSIGNMENT.length

const configFlags = new Set(['--config'])
const helpFlags = new Set(['--help', '-h'])

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

export function cmdFlagValueToArray(value: any): string[] {
  if (typeof value === 'string') {
    return value.trim().split(/, */).filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap(cmdFlagValueToArray)
  }
  return []
}

export function cmdPrefixMessage(cmdName: string, text: string): string {
  const cmdPrefix = cmdName ? `${cmdName}: ` : ''
  return `${cmdPrefix}${text}`
}

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

export function isConfigFlag(cmdArg: string): boolean {
  return configFlags.has(cmdArg) || cmdArg.startsWith(CONFIG_FLAG_ASSIGNMENT)
}

export function isHelpFlag(cmdArg: string): boolean {
  return helpFlags.has(cmdArg)
}
