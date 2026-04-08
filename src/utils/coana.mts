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

import { readJsonSync } from '@socketsecurity/registry/lib/fs'

export type ReachabilityError = {
  componentName: string
  componentVersion: string
  ghsaId: string
  subprojectPath: string
}

export function extractReachabilityErrors(
  socketFactsFile: string,
): ReachabilityError[] {
  const json = readJsonSync(socketFactsFile, { throws: false }) as
    | {
        components?: Array<{
          name?: string
          reachability?: Array<{
            ghsa_id?: string
            reachability?: Array<{
              subprojectPath?: string
              type?: string
            }>
          }>
          version?: string
        }>
      }
    | null
    | undefined
  if (!json || !Array.isArray(json.components)) {
    return []
  }
  const errors: ReachabilityError[] = []
  for (const component of json.components) {
    if (!Array.isArray(component.reachability)) {
      continue
    }
    for (const ghsaEntry of component.reachability) {
      if (!Array.isArray(ghsaEntry.reachability)) {
        continue
      }
      for (const entry of ghsaEntry.reachability) {
        if (entry.type === 'error') {
          errors.push({
            componentName: String(component.name ?? ''),
            componentVersion: String(component.version ?? ''),
            ghsaId: String(ghsaEntry.ghsa_id ?? ''),
            subprojectPath: String(entry.subprojectPath ?? ''),
          })
        }
      }
    }
  }
  return errors
}

export function extractTier1ReachabilityScanId(
  socketFactsFile: string,
): string | undefined {
  const json = readJsonSync(socketFactsFile, { throws: false })
  const tier1ReachabilityScanId = String(
    json?.['tier1ReachabilityScanId'] ?? '',
  ).trim()
  return tier1ReachabilityScanId.length > 0
    ? tier1ReachabilityScanId
    : undefined
}
