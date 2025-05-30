import type { MeowFlags } from '../flags.mts'

type HelpListOptions = {
  keyPrefix?: string | undefined
  padName?: number | undefined
}

type ListDescription =
  | { description: string }
  | { description: string; hidden: boolean }

export function getFlagListOutput(
  list: MeowFlags,
  indent: number,
  { keyPrefix = '--', padName } = {} as HelpListOptions,
): string {
  return getHelpListOutput(
    {
      ...list,
    },
    indent,
    { keyPrefix, padName },
  )
}

export function getHelpListOutput(
  list: Record<string, ListDescription>,
  indent: number,
  { keyPrefix = '', padName = 18 } = {} as HelpListOptions,
): string {
  let result = ''
  const names = Object.keys(list).sort()
  for (const name of names) {
    const entry = list[name]
    if (entry && 'hidden' in entry && entry?.hidden) {
      continue
    }
    const description =
      (typeof entry === 'object' ? entry.description : entry) || ''
    result +=
      ''.padEnd(indent) +
      (keyPrefix + name).padEnd(padName) +
      description +
      '\n'
  }
  return result.trim() || '(none)'
}
