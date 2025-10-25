/**
 * Coana integration utilities for Socket CLI.
 * Manages reachability analysis via Coana tech CLI.
 *
 * Key Functions:
 * - extractTier1ReachabilityScanId: Extract scan ID from socket facts file
 *
 * Integration:
 * - Works with @coana-tech/cli for reachability analysis
 * - Processes socket facts JSON files
 * - Extracts tier 1 reachability scan identifiers
 */

import { readJsonSync } from '@socketsecurity/lib/fs'

export function extractTier1ReachabilityScanId(
  socketFactsFile: string,
): string | undefined {
  const json = readJsonSync(socketFactsFile, { throws: false })
  if (!json || typeof json !== 'object' || !('tier1ReachabilityScanId' in json)) {
    return undefined
  }
  const rawValue = json['tier1ReachabilityScanId']
  if (rawValue == null) {
    return undefined
  }
  const tier1ReachabilityScanId = String(rawValue).trim()
  return tier1ReachabilityScanId.length > 0
    ? tier1ReachabilityScanId
    : undefined
}
