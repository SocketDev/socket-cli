import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { getPurlObject } from '../../utils/purl.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { ThreatResult, ThreadFeedResponse } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'

/**
 * Parse package info from purl using Socket's purl utilities.
 */
function parsePurl(purl: string): {
  ecosystem: string
  name: string
  version: string
} {
  try {
    const purlObj = getPurlObject(purl, { throws: false })
    if (purlObj) {
      return {
        ecosystem: purlObj.type || 'unknown',
        name: purlObj.name || 'unknown',
        version: purlObj.version || 'N/A',
      }
    }
  } catch {
    // Fallback to manual parsing if getPurlObject fails.
  }
  return { ecosystem: 'unknown', name: 'unknown', version: 'N/A' }
}

export async function outputThreatFeed(
  result: CResult<ThreadFeedResponse>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (!result.data?.results?.length) {
    logger.warn('Did not receive any data to display.')
    return
  }

  // Parse purl data for each result.
  const parsedResults = result.data.results.map((threat: ThreatResult) => ({
    ...threat,
    parsed: parsePurl(threat.purl),
  }))

  // Spawn the Ink CLI subprocess.
  const inkCliPath = path.join(
    constants.rootPath,
    'external',
    'ink',
    'threat-feed',
    'cli.js',
  )

  const { exitCode, stderr } = await spawn(process.execPath, [inkCliPath], {
    encoding: 'utf8',
    input: JSON.stringify({ results: parsedResults }),
    stdio: ['pipe', 'inherit', 'pipe'],
  })

  if (exitCode !== 0) {
    logger.error(`Ink app failed with exit code ${exitCode}`)
    if (stderr) {
      logger.error(stderr)
    }
    process.exitCode = exitCode ?? 1
  }
}
