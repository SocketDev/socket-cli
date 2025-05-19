import fs from 'node:fs'
import path from 'node:path'

import constants from '../../constants.mts'
import {
  COMPLETION_CMD_PREFIX,
  getBashrcDetails,
} from '../../utils/completion.mts'

import type { CResult } from '../../types.mts'

export async function teardownTabCompletion(
  targetName: string,
): Promise<CResult<{ action: string; left: string[] }>> {
  const result = getBashrcDetails(targetName)
  if (!result.ok) {
    return result
  }

  const { completionCommand, sourcingCommand, toAddToBashrc } = result.data

  // Remove from ~/.bashrc if found
  // Lazily access constants.homePath
  const bashrc = constants.homePath
    ? path.join(constants.homePath, '.bashrc')
    : ''

  if (bashrc && fs.existsSync(bashrc)) {
    const content = fs.readFileSync(bashrc, 'utf8')

    if (content.includes(toAddToBashrc)) {
      const newContent = content
        // Try to remove the whole thing with comment first
        .replaceAll(toAddToBashrc, '')
        // Comment may have been edited away, try to remove the command at least
        .replaceAll(sourcingCommand, '')
        .replaceAll(completionCommand, '')

      fs.writeFileSync(bashrc, newContent, 'utf8')

      return {
        ok: true,
        data: {
          action: 'removed',
          left: findRemainingCompletionSetups(newContent),
        },
        message: 'Removed completion from ~/.bashrc',
      }
    } else {
      const left = findRemainingCompletionSetups(content)
      return {
        ok: true,
        data: {
          action: 'missing',
          left,
        },
        message: `Completion was not found in ~/.bashrc${left.length ? ' (you may need to manually edit your .bashrc to clean this up...)' : ''}`,
      }
    }
  } else {
    return {
      ok: true, // Eh. I think this makes most sense.
      data: { action: 'not found', left: [] },
      message: '~/.bashrc not found, skipping',
    }
  }
}

function findRemainingCompletionSetups(bashrc: string): string[] {
  return bashrc
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.startsWith(COMPLETION_CMD_PREFIX))
    .map(s => s.slice(COMPLETION_CMD_PREFIX.length).trim())
}
