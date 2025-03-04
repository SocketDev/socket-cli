import fs from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'
import { components } from '@socketsecurity/sdk/types/api'

import { getFullScan } from './get-full-scan'
import { mdTable } from '../../utils/markdown'

export async function viewFullScan(
  orgSlug: string,
  fullScanId: string,
  filePath: string
): Promise<void> {
  const artifacts: Array<components['schemas']['SocketArtifact']> | undefined =
    await getFullScan(orgSlug, fullScanId)
  if (!artifacts) return

  const display = artifacts.map(art => {
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

Sscan ID: ${fullScanId}

${md}

View this report at: https://socket.dev/dashboard/org/${orgSlug}/sbom/${fullScanId}
  `.trim() + '\n'

  if (filePath && filePath !== '-') {
    try {
      await fs.writeFile(filePath, report, 'utf8')
      logger.log(`Data successfully written to ${filePath}`)
    } catch (e) {
      process.exitCode = 1
      logger.fail('There was an error trying to write the json to disk')
      logger.error(e)
    }
  } else {
    logger.log(report)
  }
}
