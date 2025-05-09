import fs from 'node:fs'
import path from 'node:path'

import { getBashrcDetails } from '../../utils/completion.mts'

import type { CResult } from '../../types.mts'

export async function teardownTabCompletion(
  targetName: string
): Promise<CResult<{ action: string }>> {
  const result = getBashrcDetails(targetName)
  if (!result.ok) {
    return result
  }

  const { completionCommand, sourcingCommand, toAddToBashrc } = result.data

  // Add to ~/.bashrc if not already there
  const bashrc = process.env['HOME']
    ? path.join(process.env['HOME'], '.bashrc')
    : ''

  if (bashrc && fs.existsSync(bashrc)) {
    const content = fs.readFileSync(bashrc, 'utf8')

    if (content.includes(sourcingCommand)) {
      fs.writeFileSync(
        bashrc,
        content
          // Try to remove the whole thing with comment first
          .replaceAll(toAddToBashrc, '')
          // Comment may have been edited away, try to remove the command at least
          .replaceAll(sourcingCommand, '')
          .replaceAll(completionCommand, ''),
        'utf8'
      )

      return {
        ok: true,
        data: { action: 'removed' },
        message: 'Removed completion from ~/.bashrc'
      }
    } else {
      return {
        ok: true,
        data: { action: 'missing' },
        message: 'Completion was not found in ~/.bashrc'
      }
    }
  } else {
    return {
      ok: true, // Eh. I think this makes most sense.
      data: { action: 'not found' },
      message: '~/.bashrc not found, skipping'
    }
  }
}
