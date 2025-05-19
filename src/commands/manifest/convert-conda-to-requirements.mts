import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { CResult } from '../../types.mts'

export async function convertCondaToRequirements(
  target: string,
  cwd: string,
  verbose: boolean,
): Promise<CResult<{ contents: string; pip: string }>> {
  let contents: string
  if (target === '-') {
    if (verbose) {
      logger.info(`[VERBOSE] reading input from stdin`)
    }

    const buf: string[] = []
    contents = await new Promise((resolve, reject) => {
      process.stdin.on('data', chunk => {
        const input = chunk.toString()
        buf.push(input)
      })
      process.stdin.on('end', () => {
        resolve(buf.join(''))
      })
      process.stdin.on('error', e => {
        if (verbose) {
          logger.error('Unexpected error while reading from stdin:', e)
        }
        reject(e)
      })
      process.stdin.on('close', () => {
        if (buf.length === 0) {
          if (verbose) {
            logger.error('stdin closed explicitly without data received')
          }
          reject(new Error('No data received from stdin'))
        } else {
          if (verbose) {
            logger.error(
              'warning: stdin closed explicitly with some data received',
            )
          }
          resolve(buf.join(''))
        }
      })
    })

    if (!contents) {
      return {
        ok: false,
        message: 'Manifest Generation Failed',
        cause: 'No data received from stdin',
      }
    }
  } else {
    const f = path.resolve(cwd, target)

    if (verbose) {
      logger.info(`[VERBOSE] target file: ${f}`)
    }

    if (!fs.existsSync(f)) {
      return {
        ok: false,
        message: 'Manifest Generation Failed',
        cause: `Input file not found at ${f}`,
      }
    }

    contents = fs.readFileSync(target, 'utf8')

    if (!contents) {
      return {
        ok: false,
        message: 'Manifest Generation Failed',
        cause: 'File is empty',
      }
    }
  }

  return {
    ok: true,
    data: {
      contents,
      pip: convertCondaToRequirementsFromInput(contents),
    },
  }
}

// Just extract the first pip block, if one exists at all.
export function convertCondaToRequirementsFromInput(input: string): string {
  const keeping: string[] = []
  let collecting = false
  let delim = '-'
  let indent = ''
  input.split('\n').some(line => {
    if (!line) {
      // Ignore empty lines
      return
    }
    if (collecting) {
      if (line.startsWith('#')) {
        // Ignore comment lines (keep?)
        return
      }
      if (line.startsWith(delim)) {
        // In this case we have a line with the same indentation as the
        // `- pip:` line, so we have reached the end of the pip block.
        return true // the end
      } else {
        if (!indent) {
          // Store the indentation of the block
          if (line.trim().startsWith('-')) {
            indent = line.split('-')[0] + '-'
            if (indent.length <= delim.length) {
              // The first line after the `pip:` line does not indent further
              // than that so the block is empty?
              return true
            }
          }
        }
        if (line.startsWith(indent)) {
          keeping.push(line.slice(indent.length).trim())
        } else {
          // Unexpected input. bail.
          return true
        }
      }
    } else {
      // Note: the line may end with a line comment so don't === it.
      if (line.trim().startsWith('- pip:')) {
        delim = line.split('-')[0] + '-'
        collecting = true
      }
    }
  })

  return keeping.join('\n')
}
