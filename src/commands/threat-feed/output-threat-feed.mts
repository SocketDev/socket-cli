import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { getPurlObject } from '../../utils/purl.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { ThreadFeedResponse, ThreatResult } from './types.mts'
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
    constants.externalPath,
    'ink',
    'threat-feed',
    'cli.js',
  )

  const spawnPromise = spawn(process.execPath, [inkCliPath], {
    stdioString: true,
    stdio: ['pipe', 'inherit', 'pipe'],
  })

  // Write data to stdin.
  if (spawnPromise.stdin) {
    spawnPromise.stdin.write(JSON.stringify({ results: parsedResults }))
    spawnPromise.stdin.end()
  }

  const spawnResult = await spawnPromise

  if (spawnResult.code !== 0) {
    logger.error(`Ink app failed with exit code ${spawnResult.code}`)
    const stderr = spawnResult.stderr.toString()
    if (stderr) {
      logger.error(stderr)
    }
    process.exitCode = spawnResult.code
  }
}
