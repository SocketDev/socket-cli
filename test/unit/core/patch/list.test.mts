import { describe, expect, it } from 'vitest'

import {
  formatPatchListJson,
  formatPatchListText,
  getPatchListEntries,
} from '../../../../src/core/patch/list.mts'

import type { PatchManifest } from '../../../../src/core/patch/manifest.mts'

const manifest: PatchManifest = {
  patches: {
    'pkg:npm/zebra@1.0.0': {
      uuid: '22222222-2222-2222-2222-222222222222',
      exportedAt: '2026-01-01T00:00:00Z',
      files: { 'lib/z.js': { beforeHash: 'a', afterHash: 'b' } },
      vulnerabilities: {},
      description: 'second patch',
      license: 'MIT',
      tier: 'free',
    },
    'pkg:npm/apple@1.0.0': {
      uuid: '11111111-1111-1111-1111-111111111111',
      exportedAt: '2026-01-01T00:00:00Z',
      files: { 'index.js': { beforeHash: 'c', afterHash: 'd' } },
      vulnerabilities: {
        'GHSA-aaaa-bbbb-cccc': {
          cves: ['CVE-2026-1234'],
          summary: 'Header\u001b[31m issue',
          severity: 'high',
          description: 'Details',
        },
      },
      description: 'first patch',
      license: 'MIT',
      tier: 'free',
    },
  },
}

describe('patch list formatting', () => {
  it('sorts patches, files, and vulnerabilities for stable output', () => {
    const entries = getPatchListEntries(manifest)

    expect(entries.map(entry => entry.purl)).toEqual([
      'pkg:npm/apple@1.0.0',
      'pkg:npm/zebra@1.0.0',
    ])
    expect(entries[0]?.files).toEqual(['index.js'])
    expect(
      entries[0]?.vulnerabilities.map(vulnerability => vulnerability.id),
    ).toEqual(['GHSA-aaaa-bbbb-cccc'])
  })

  it('removes terminal controls from human-readable patch metadata', () => {
    const output = formatPatchListText(manifest)

    expect(output).toContain('Found 2 patches:')
    expect(output).toContain('Header[31m issue')
    expect(output).not.toContain('\u001b')
    expect(output.indexOf('pkg:npm/apple@1.0.0')).toBeLessThan(
      output.indexOf('pkg:npm/zebra@1.0.0'),
    )
  })

  it('removes terminal controls from text identifiers and preserves JSON values', () => {
    const purl = 'pkg:npm/fable-pixel\u001b[31m\u007f\u0085\n\t@1.0.0'
    const uuid = 'fable-uuid\u001b[2J\u007f\u0085\n\t'
    const record = manifest.patches['pkg:npm/apple@1.0.0']!
    const unsafeManifest: PatchManifest = {
      patches: {
        [purl]: { ...record, description: 'first patch\ncontinued', uuid },
      },
    }

    const textOutput = formatPatchListText(unsafeManifest)
    const jsonOutput = JSON.parse(formatPatchListJson(unsafeManifest)) as {
      patches: Array<{ purl: string; uuid: string }>
    }

    expect(textOutput).toContain('pkg:npm/fable-pixel[31m@1.0.0')
    expect(textOutput).toContain('UUID: fable-uuid[2J')
    expect(textOutput).toContain('Description: first patch\ncontinued')
    expect(textOutput).not.toMatch(/[\u001b\u007f\u0085]/u)
    expect(jsonOutput.patches[0]?.purl).toBe(purl)
    expect(jsonOutput.patches[0]?.uuid).toBe(uuid)
  })

  it('emits a JSON object with sorted patch entries', () => {
    const output = JSON.parse(formatPatchListJson(manifest)) as {
      status: string
      found: number
      patches: Array<{ purl: string }>
    }

    expect(output.status).toBe('success')
    expect(output.found).toBe(2)
    expect(output.patches.map(patch => patch.purl)).toEqual([
      'pkg:npm/apple@1.0.0',
      'pkg:npm/zebra@1.0.0',
    ])
  })

  it('reports an empty manifest without an error', () => {
    expect(formatPatchListText({ patches: {} })).toBe(
      'No patches found in manifest.',
    )
    expect(JSON.parse(formatPatchListJson({ patches: {} })).found).toBe(0)
  })
})
