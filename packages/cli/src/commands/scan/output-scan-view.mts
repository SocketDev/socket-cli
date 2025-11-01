import fs from 'node:fs/promises'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { SOCKET_WEBSITE_URL } from '../../constants/socket.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { fileLink } from '../../utils/terminal/link.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'

export async function outputScanView(
  result: CResult<SocketArtifact[]>,
  orgSlug: string,
  scanId: string,
  filePath: string,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      getDefaultLogger().log(serializeResultJson(result))
      return
    }
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (
    outputKind === 'json' ||
    (outputKind === 'text' && filePath && filePath.endsWith('.json'))
  ) {
    const json = serializeResultJson(result)

    if (filePath && filePath !== '-') {
      getDefaultLogger().info('Writing json results to', filePath)
      try {
        await fs.writeFile(filePath, json, 'utf8')
        getDefaultLogger().info(
          `Data successfully written to ${fileLink(filePath)}`,
        )
      } catch (e) {
        process.exitCode = 1
        getDefaultLogger().fail(
          'There was an error trying to write the markdown to disk',
        )
        getDefaultLogger().error(e)
        getDefaultLogger().log(
          serializeResultJson({
            ok: false,
            message: 'File Write Failure',
            cause: 'Failed to write json to disk',
          }),
        )
      }
      return
    }

    getDefaultLogger().log(json)
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
      score: JSON.stringify(art.score),
    }
  })

  const md = mdTable<any>(display, [
    'type',
    'version',
    'name',
    'author',
    'score',
  ])

  const report = `${`
# Scan Details

These are the artifacts and their scores found.

Scan ID: ${scanId}

${md}

View this report at: ${SOCKET_WEBSITE_URL}/dashboard/org/${orgSlug}/sbom/${scanId}
  `.trim()}\n`

  if (filePath && filePath !== '-') {
    try {
      await fs.writeFile(filePath, report, 'utf8')
      getDefaultLogger().log(
        `Data successfully written to ${fileLink(filePath)}`,
      )
    } catch (e) {
      process.exitCode = 1
      getDefaultLogger().fail(
        'There was an error trying to write the markdown to disk',
      )
      getDefaultLogger().error(e)
    }
  } else {
    getDefaultLogger().log(report)
  }
}
