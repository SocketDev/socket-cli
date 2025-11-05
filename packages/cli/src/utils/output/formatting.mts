/**
 * Output formatting utilities for Socket CLI.
 * Provides consistent formatting for help text and command output.
 *
 * Key Functions:
 * - getFlagApiRequirementsOutput: Format API requirements for flags
 * - getHelpListOutput: Format help text lists with descriptions
 * - getFlagsHelpOutput: Generate formatted help for command flags
 *
 * Formatting Features:
 * - Automatic indentation and alignment
 * - Flag description formatting
 * - Requirements and permissions display
 * - Hidden flag filtering
 *
 * Usage:
 * - Used by command help systems
 * - Provides consistent terminal output formatting
 * - Handles kebab-case conversion for flags
 */

import { joinAnd } from '@socketsecurity/lib/arrays'
import { isObject } from '@socketsecurity/lib/objects'
import { naturalCompare } from '@socketsecurity/lib/sorts'
import { indentString } from '@socketsecurity/lib/strings'
import { pluralize } from '@socketsecurity/lib/words'

import { camelToKebab } from '../data/strings.mts'
import {
  getRequirements,
  getRequirementsKey,
} from '../ecosystem/requirements.mts'

import type { MeowFlags } from '../../flags.mts'

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
      lines.push(
        `${padding}- Quota: ${quota} ${pluralize('unit', { count: quota })}`,
      )
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

// Alias for testing compatibility.
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
