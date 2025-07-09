import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

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
  options?: HelpListOptions | undefined,
): string {
  const { keyPrefix = '--', padName } = {
    __proto__: null,
    ...options,
  } as HelpListOptions
  return getHelpListOutput(
    {
      ...list,
    },
    { keyPrefix, padName },
  )
}

export function getHelpListOutput(
  list: Record<string, ListDescription>,
  options?: HelpListOptions | undefined,
): string {
  const { keyPrefix = '', padName = 18 } = {
    __proto__: null,
    ...options,
  } as HelpListOptions
  let result = ''
  const names = Object.keys(list).sort(naturalCompare)
  for (const name of names) {
    const entry = list[name]
    if (entry && 'hidden' in entry && entry?.hidden) {
      continue
    }
    const description =
      (typeof entry === 'object' ? entry.description : entry) || ''
    result += (keyPrefix + name).padEnd(padName) + description
  }
  return result.trim() || '(none)'
}
