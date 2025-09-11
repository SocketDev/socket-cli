import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { isObject } from '@socketsecurity/registry/lib/objects'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { indentString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { getRequirements, getRequirementsKey } from './requirements.mts'

import type { MeowFlags } from '../flags.mts'

type ApiRequirementsOptions = {
  indent?: number | undefined
}

type HelpListOptions = {
  indent?: number | undefined
  keyPrefix?: string | undefined
  padName?: number | undefined
}

type ListDescription =
  | { description: string }
  | { description: string; hidden: boolean }

function camelToKebab(string: string): string {
  return string.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

export function getFlagApiRequirementsOutput(
  cmdPath: string,
  options?: ApiRequirementsOptions | undefined,
): string {
  const { indent = 6 } = {
    __proto__: null,
    ...options,
  } as ApiRequirementsOptions
  const key = getRequirementsKey(cmdPath)
  const requirements = getRequirements()
  const data = (requirements.api as any)[key]
  let result = ''
  if (data) {
    const quota: number = data?.quota
    const rawPerms: string[] = data?.permissions
    const padding = ''.padEnd(indent)
    const lines = []
    if (Number.isFinite(quota) && quota > 0) {
      lines.push(`${padding}- Quota: ${quota} ${pluralize('unit', quota)}`)
    }
    if (Array.isArray(rawPerms) && rawPerms.length) {
      const perms = rawPerms.slice().sort(naturalCompare)
      lines.push(`${padding}- Permissions: ${joinAnd(perms)}`)
    }
    result += lines.join('\n')
  }
  return result.trim() || '(none)'
}

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
    padName = 20,
  } = {
    __proto__: null,
    ...options,
  } as HelpListOptions
  let result = ''
  const names = Object.keys(list).sort(naturalCompare)
  for (const name of names) {
    const entry = list[name]
    const entryIsObj = isObject(entry)
    if (entryIsObj && 'hidden' in entry && entry?.hidden) {
      continue
    }
    const printedName = `${keyPrefix}${camelToKebab(name)}`
    const preDescription = `${''.padEnd(indent)}${printedName.padEnd(Math.max(printedName.length + 2, padName))}`

    result += preDescription

    const description = entryIsObj ? entry.description : String(entry)
    if (description) {
      result += indentString(description, preDescription.length).trimStart()
    }
    result += '\n'
  }
  return result.trim() || '(none)'
}
