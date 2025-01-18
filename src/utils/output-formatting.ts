type HelpListOptions = {
  keyPrefix: string
  padName: number
}

type ListDescription = string | { description: string }

export function getFlagListOutput(
  list: Record<string, ListDescription>,
  indent: number,
  { keyPrefix = '--', padName } = <HelpListOptions>{}
): string {
  return getHelpListOutput(
    {
      ...list
    },
    indent,
    { keyPrefix, padName }
  )
}

export function getHelpListOutput(
  list: Record<string, ListDescription>,
  indent: number,
  { keyPrefix = '', padName = 18 } = <HelpListOptions>{}
): string {
  let result = ''
  const names = Object.keys(list).sort()
  for (const name of names) {
    const rawDescription = list[name]
    const description =
      (typeof rawDescription === 'object'
        ? rawDescription.description
        : rawDescription) || ''
    result +=
      ''.padEnd(indent) +
      (keyPrefix + name).padEnd(padName) +
      description +
      '\n'
  }
  return result.trim()
}
