import fs from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'

import { CResult, OutputKind } from '../../types'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { mdTable } from '../../utils/markdown'
import { serializeResultJson } from '../../utils/serialize-result-json'

import type { components } from '@socketsecurity/sdk/types/api'

export async function outputScanView(
  result: CResult<Array<components['schemas']['SocketArtifact']>>,
  orgSlug: string,
  scanId: string,
  filePath: string,
  outputKind: OutputKind
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      logger.log(serializeResultJson(result))
      logger.log('')
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (
    outputKind === 'json' ||
    (outputKind === 'text' && filePath && filePath.endsWith('.json'))
  ) {
    const json = serializeResultJson(result)

    if (filePath && filePath !== '-') {
      logger.info('Writing json results to', filePath)
      try {
        await fs.writeFile(filePath, json, 'utf8')
        logger.info(`Data successfully written to ${filePath}`)
      } catch (e) {
        process.exitCode = 1
        logger.fail('There was an error trying to write the markdown to disk')
        logger.error(e)
        logger.log(
          serializeResultJson({
            ok: false,
            message: 'File Write Failure',
            cause: 'Failed to write json to disk'
          })
        )
        logger.log('')
      }
      return
    }

    logger.log(json)
    logger.log('')
    return
  }

  const display = result.data.map(art => {
    const author = Array.isArray(art.author)
      ? `${art.author[0]}${art.author.length > 1 ? ' et.al.' : ''}`
      : art.author
    return {
      type: art.type,
      name: art.name,
      version: art.version,
      author,
      score: JSON.stringify(art.score)
    }
  })

  const md = mdTable<any>(display, [
    'type',
    'version',
    'name',
    'author',
    'score'
  ])

  const report =
    `
# Scan Details

These are the artifacts and their scores found.

Scan ID: ${scanId}

${md}

View this report at: https://socket.dev/dashboard/org/${orgSlug}/sbom/${scanId}
  `.trim() + '\n'

  if (filePath && filePath !== '-') {
    try {
      await fs.writeFile(filePath, report, 'utf8')
      logger.log(`Data successfully written to ${filePath}`)
    } catch (e) {
      process.exitCode = 1
      logger.fail('There was an error trying to write the markdown to disk')
      logger.error(e)
    }
  } else {
    logger.log(report)
  }
}
