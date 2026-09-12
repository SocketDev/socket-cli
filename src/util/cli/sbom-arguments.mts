export function normalizeSbomDirectoryArguments(
  args: readonly string[],
): readonly string[] {
  let index = 0
  while (index < args.length) {
    const arg = args[index]!
    if (arg === '--dir' || arg === '-C') {
      if (args[index + 1] === undefined) {
        return args
      }
      index += 2
    } else if (
      arg.startsWith('--dir=') ||
      (arg.startsWith('-C') && arg.length > 2)
    ) {
      index += 1
    } else {
      break
    }
  }
  return index > 0 && args[index] === 'sbom'
    ? ['sbom', ...args.slice(0, index), ...args.slice(index + 1)]
    : args
}
