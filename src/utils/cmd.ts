export function cmdFlagsToString(args: string[]) {
  let result = []
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
