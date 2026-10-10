import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'

import type { PatchManifest, PatchManifestRecord } from './manifest.mts'

export interface PatchListEntry {
  purl: string
  uuid: string
  exportedAt: string
  description: string
  license: string
  tier: string
  files: string[]
  vulnerabilities: Array<{
    id: string
    cves: string[]
    summary: string
    severity: string
    description: string
  }>
}

export function formatPatchListEntry(entry: PatchListEntry): string {
  const lines = [
    sanitizePatchText(entry.purl).replaceAll('\n', '').replaceAll('\t', ''),
    `  UUID: ${sanitizePatchText(entry.uuid).replaceAll('\n', '').replaceAll('\t', '')}`,
  ]
  if (entry.tier) {
    lines.push(`  Tier: ${entry.tier}`)
  }
  if (entry.license) {
    lines.push(`  License: ${entry.license}`)
  }
  if (entry.exportedAt) {
    lines.push(`  Exported: ${sanitizePatchText(entry.exportedAt)}`)
  }
  if (entry.description) {
    lines.push(`  Description: ${entry.description}`)
  }
  if (entry.vulnerabilities.length > 0) {
    lines.push(`  Vulnerabilities (${entry.vulnerabilities.length}):`)
    for (const vulnerability of entry.vulnerabilities) {
      const cves = vulnerability.cves.length
        ? ` (${vulnerability.cves.join(', ')})`
        : ''
      lines.push(`    - ${vulnerability.id}${cves}`)
      if (vulnerability.severity) {
        lines.push(`      Severity: ${vulnerability.severity.toUpperCase()}`)
      }
      if (vulnerability.summary) {
        lines.push(`      Summary: ${vulnerability.summary}`)
      }
    }
  }
  if (entry.files.length > 0) {
    lines.push(`  Files patched (${entry.files.length}):`)
    lines.push(...entry.files.map(file => `    - ${sanitizePatchText(file)}`))
  }
  return lines.join('\n')
}

export function formatPatchListJson(manifest: PatchManifest): string {
  const patches = getPatchListEntries(manifest)
  return stringifyWithFormatting(
    {
      __proto__: null,
      status: 'success',
      found: patches.length,
      patches,
    },
    getDefaultFormatting(),
  )
}

export function formatPatchListText(manifest: PatchManifest): string {
  const patches = getPatchListEntries(manifest)
  if (patches.length === 0) {
    return 'No patches found in manifest.'
  }

  const header = `Found ${patches.length} ${patches.length === 1 ? 'patch' : 'patches'}:`
  const entries = patches.map(formatPatchListEntry).join('\n\n')
  return `${header}\n\n${entries}`
}

export function getPatchListEntries(manifest: PatchManifest): PatchListEntry[] {
  return Object.entries(manifest.patches)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([purl, record]) => patchRecordToListEntry(purl, record))
}

export function patchRecordToListEntry(
  purl: string,
  record: PatchManifestRecord,
): PatchListEntry {
  return {
    __proto__: null,
    purl,
    uuid: record.uuid,
    exportedAt: sanitizePatchText(record.exportedAt),
    description: sanitizePatchText(record.description),
    license: sanitizePatchText(record.license),
    tier: sanitizePatchText(record.tier),
    files: Object.keys(record.files).toSorted((a, b) => a.localeCompare(b)),
    vulnerabilities: Object.entries(record.vulnerabilities)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([id, vulnerability]) => ({
        __proto__: null,
        id: sanitizePatchText(id),
        cves: vulnerability.cves.map(sanitizePatchText),
        summary: sanitizePatchText(vulnerability.summary),
        severity: sanitizePatchText(vulnerability.severity),
        description: sanitizePatchText(vulnerability.description),
      })),
  }
}

export function sanitizePatchText(value: string): string {
  return Array.from(value.replaceAll('\r\n', '\n'))
    .filter(character => {
      const code = character.codePointAt(0) ?? 0
      return (
        character === '\n' ||
        character === '\t' ||
        (code >= 0x20 && (code < 0x7f || code > 0x9f))
      )
    })
    .join('')
}
