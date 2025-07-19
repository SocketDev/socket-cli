import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import type { CResult } from '../../types.mts'

function prepareContent(content: string): string {
  return stripAnsi(content.trim())
}

export async function convertCondaToRequirements(
  filename: string,
  cwd: string,
  verbose: boolean,
): Promise<CResult<{ content: string; pip: string }>> {
  let content: string
  if (filename === '-') {
    if (verbose) {
      logger.info(`[VERBOSE] reading input from stdin`)
    }

    const strings: string[] = []
    content = await new Promise((resolve, reject) => {
      process.stdin.on('data', chunk => {
        const input = chunk.toString()
        strings.push(input)
      })
      process.stdin.on('end', () => {
        resolve(prepareContent(strings.join('')))
      })
      process.stdin.on('error', e => {
        if (verbose) {
          logger.error('Unexpected error while reading from stdin:', e)
        }
        reject(e)
      })
      process.stdin.on('close', () => {
        if (strings.length) {
          if (verbose) {
            logger.error(
              'warning: stdin closed explicitly with some data received',
            )
          }
          resolve(prepareContent(strings.join('')))
        } else {
          if (verbose) {
            logger.error('stdin closed explicitly without data received')
          }
          reject(new Error('No data received from stdin'))
        }
      })
    })

    if (!content) {
      return {
        ok: false,
        message: 'Manifest Generation Failed',
        cause: 'No data received from stdin',
      }
    }
  } else {
    const filepath = path.join(cwd, filename)

    if (verbose) {
      logger.info(`[VERBOSE] target: ${filepath}`)
    }

    if (!existsSync(filepath)) {
      return {
        ok: false,
        message: 'Manifest Generation Failed',
        cause: `The file was not found at ${filepath}`,
      }
    }

    content = readFileSync(filepath, 'utf8')

    if (!content) {
      return {
        ok: false,
        message: 'Manifest Generation Failed',
        cause: `File at ${filepath} is empty`,
      }
    }
  }

  return {
    ok: true,
    data: {
      content,
      pip: convertCondaToRequirementsFromInput(content),
    },
  }
}

// Just extract the first pip block, if one exists at all.
export function convertCondaToRequirementsFromInput(input: string): string {
  let collecting = false
  let delim = '-'
  let indent = ''
  const keeping: string[] = []
  for (const line of input.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      // Ignore empty lines.
      continue
    }
    if (collecting) {
      if (line.startsWith('#')) {
        // Ignore comment lines (keep?).
        continue
      }
      if (line.startsWith(delim)) {
        // In this case we have a line with the same indentation as the
        // `- pip:` line, so we have reached the end of the pip block.
        break
      }
      if (!indent) {
        // Store the indentation of the block.
        if (trimmed.startsWith('-')) {
          indent = line.split('-')[0] + '-'
          if (indent.length <= delim.length) {
            // The first line after the `pip:` line does not indent further
            // than that so the block is empty?
            break
          }
        }
      }
      if (line.startsWith(indent)) {
        keeping.push(line.slice(indent.length).trim())
      } else {
        // Unexpected input. bail.
        break
      }
    }
    // Note: the line may end with a line comment so don't === it.
    else if (trimmed.startsWith('- pip:')) {
      delim = line.split('-')[0] + '-'
      collecting = true
    }
  }

  return prepareContent(keeping.join('\n'))
}
