/**
 * Coana integration utilities for Socket CLI. Manages reachability analysis via
 * Coana tech CLI.
 *
 * Key Functions: - extractTier1ReachabilityScanId: Extract scan ID from socket
 * facts file.
 *
 * Integration: - Works with @coana-tech/cli for reachability analysis -
 * Processes socket facts JSON files - Extracts tier 1 reachability scan
 * identifiers.
 */

import { readJsonSync } from '@socketsecurity/lib-stable/fs/read-json'

export function extractTier1ReachabilityScanId(
  socketFactsFile: string,
): string | undefined {
  const json = readJsonSync(socketFactsFile, { throws: false })
  if (
    !json ||
    typeof json !== 'object' ||
    !('tier1ReachabilityScanId' in json)
  ) {
    return undefined
  }
  const rawValue = json['tier1ReachabilityScanId']
  // Scan ids are strings; tolerate numbers, but reject objects/arrays whose
  // String() form would be a useless '[object Object]'.
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return undefined
  }
  const tier1ReachabilityScanId = String(rawValue).trim()
  return tier1ReachabilityScanId.length > 0
    ? tier1ReachabilityScanId
    : undefined
}
