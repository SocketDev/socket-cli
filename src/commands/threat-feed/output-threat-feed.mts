/** @fileoverview Threat feed output formatter for Socket CLI. Displays security threat intelligence in JSON or text formats. Shows malicious packages, threat types, and security recommendations. */

import { render } from 'ink'
import React from 'react'

import { logger } from '@socketsecurity/registry/lib/logger'

import { ThreatFeedApp } from './ThreatFeedApp.js'
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

  // Render the Ink app directly in the current process.
  const { waitUntilExit } = render(
    React.createElement(ThreatFeedApp, {
      results: parsedResults,
    }),
  )

  await waitUntilExit()
}
