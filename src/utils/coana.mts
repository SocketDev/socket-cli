import { readJsonSync } from '@socketsecurity/registry/lib/fs'

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
