const helpFlags = new Set(['--help', '-h'])

export function cmdFlagsToString(args: string[]) {
  const result = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    if (args[i]!.startsWith('--')) {
      // Check if the next item exists and is NOT another flag.
      if (i + 1 < length && !args[i + 1]!.startsWith('--')) {
        result.push(`${args[i]}=${args[i + 1]}`)
        i += 1
      } else {
        result.push(args[i])
      }
    }
  }
  return result.join(' ')
}

export function cmdFlagValueToArray(flagValue: any): string[] {
  if (typeof flagValue === 'string') {
    return flagValue.trim().split(/, */)
  }
  if (Array.isArray(flagValue)) {
    return flagValue.flatMap(v => v.split(/, */))
  }
  return []
}

export function cmdPrefixMessage(cmdName: string, text: string): string {
  const cmdPrefix = cmdName ? `${cmdName}: ` : ''
  return `${cmdPrefix}${text}`
}

export function isHelpFlag(cmdArg: string) {
  return helpFlags.has(cmdArg)
}
