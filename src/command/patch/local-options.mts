import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { sanitizePatchText } from '../../core/patch/list.mts'
import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'

const logger = getDefaultLogger()

export type PatchLocalCommand = 'list' | 'remove'

export interface PatchLocalParseResult {
  error?: string | undefined
  help: boolean
  identifier?: string | undefined
  json: boolean
  projectRoot: string
}

export function getPatchCwdValue(
  args: readonly string[],
  index: number,
): string | undefined {
  const arg = args[index]!
  const value = arg === '--cwd' ? args[index + 1] : arg.slice('--cwd='.length)
  if (!value || (arg === '--cwd' && value.startsWith('-'))) {
    return undefined
  }
  return value
}

export function parsePatchLocalOptions(
  args: readonly string[],
  command: PatchLocalCommand,
): PatchLocalParseResult {
  const options: PatchLocalParseResult = {
    __proto__: null,
    help: false,
    json: false,
    projectRoot: process.cwd(),
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--help' || arg === '-h') {
      options.help = true
      return options
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--cwd' || arg.startsWith('--cwd=')) {
      const value = getPatchCwdValue(args, index)
      if (value === undefined) {
        options.error = 'The --cwd option requires a directory path'
        return options
      }
      options.projectRoot = path.resolve(value)
      if (arg === '--cwd') {
        index += 1
      }
      continue
    }
    if (arg === '--skip-rollback') {
      if (command === 'list') {
        options.error = 'The list command does not accept --skip-rollback'
        return options
      }
      continue
    }
    if (arg.startsWith('-')) {
      options.error = `Unknown patch ${command} option: ${arg}`
      return options
    }
    if (command === 'remove' && options.identifier === undefined) {
      options.identifier = arg
      continue
    }
    options.error =
      command === 'list'
        ? 'The list command does not accept positional arguments'
        : 'Only one patch PURL or UUID can be removed'
    return options
  }

  return options
}

export function reportPatchError(
  output: 'json' | 'text',
  code: string,
  message: string,
): void {
  if (output === 'json') {
    const serialized = stringifyWithFormatting(
      { __proto__: null, status: 'error', code, message },
      getDefaultFormatting(),
    )
    logger.error(
      serialized.endsWith('\n') ? serialized.slice(0, -1) : serialized,
    )
    return
  }
  logger.error(`Error: ${sanitizePatchText(message)}`)
}
