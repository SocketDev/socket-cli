/**
 * Output formatting utilities for Socket CLI.
 * Provides consistent formatting for help text and command output.
 *
 * Key Functions:
 * - getFlagApiRequirementsOutput: Format API requirements for flags
 * - getHelpListOutput: Format help text lists with descriptions
 * - getFlagsHelpOutput: Generate formatted help for command flags
 * - formatTable: Format data as ASCII table with borders
 * - formatSimpleTable: Format data as simple aligned columns
 *
 * Formatting Features:
 * - Automatic indentation and alignment
 * - Flag description formatting
 * - Requirements and permissions display
 * - Hidden flag filtering
 * - Table rendering with borders and alignment
 *
 * Usage:
 * - Used by command help systems
 * - Provides consistent terminal output formatting
 * - Handles kebab-case conversion for flags
 */

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { isObject } from '@socketsecurity/registry/lib/objects'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { indentString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { getRequirements, getRequirementsKey } from './requirements.mts'
import { camelToKebab } from './strings.mts'

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

export function getFlagApiRequirementsOutput(
  cmdPath: string,
  options?: ApiRequirementsOptions | undefined,
): string {
  const { indent = 6 } = {
    __proto__: null,
    ...options,
  } as ApiRequirementsOptions
  const keys = getRequirementsKey(cmdPath)
  const requirements = getRequirements()

  // Combine requirements from multiple SDK methods
  let totalQuota = 0
  const allPerms = new Set<string>()

  for (const k of keys) {
    const data = (requirements.api as any)[k]
    if (data) {
      const quota: number = data?.quota
      const rawPerms: string[] = data?.permissions
      if (Number.isFinite(quota) && quota > 0) {
        totalQuota += quota
      }
      if (Array.isArray(rawPerms)) {
        for (const perm of rawPerms) {
          allPerms.add(perm)
        }
      }
    }
  }

  const padding = ''.padEnd(indent)
  const lines = []
  if (totalQuota > 0) {
    lines.push(
      `${padding}- Quota: ${totalQuota} ${pluralize('unit', { count: totalQuota })}`,
    )
  }
  if (allPerms.size > 0) {
    const perms = [...allPerms].sort(naturalCompare)
    lines.push(`${padding}- Permissions: ${joinAnd(perms)}`)
  }

  return lines.length > 0 ? lines.join('\n') : '(none)'
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

// Alias for testing compatibility
export const getFlagsHelpOutput = getFlagListOutput

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
      result += indentString(description, {
        count: preDescription.length,
      }).trimStart()
    }
    result += '\n'
  }
  return result.trim() || '(none)'
}

/**
 * Table formatting utilities - re-exported from @socketsecurity/registry
 */
export type {
  ColumnAlignment,
  TableColumn,
} from '@socketsecurity/registry/lib/tables'
export {
  formatSimpleTable,
  formatTable,
} from '@socketsecurity/registry/lib/tables'
