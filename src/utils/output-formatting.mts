import { isObject } from '@socketsecurity/registry/lib/objects'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import type { MeowFlags } from '../flags.mts'

type HelpListOptions = {
  indent?: number | undefined
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
  const { keyPrefix = '--' } = {
    __proto__: null,
    ...options,
  } as HelpListOptions
  return getHelpListOutput(
    {
      ...list,
    },
    { ...options, keyPrefix },
  )
}

export function getHelpListOutput(
  list: Record<string, ListDescription>,
  options?: HelpListOptions | undefined,
): string {
  const {
    indent = 6,
    keyPrefix = '',
    padName = 18,
  } = {
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
    const description = (isObject(entry) ? entry.description : entry) || ''
    result +=
      ''.padEnd(indent) +
      (keyPrefix + name).padEnd(padName) +
      description +
      '\n'
  }
  return result.trim() || '(none)'
}
