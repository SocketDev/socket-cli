import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { describe, expect, it } from 'vitest'

import {
  findScannerPatternMatches,
  isExecutableScannerPatternRule,
  isScannerPatternSeverityEnabled,
  scanWithScannerPatterns,
  scannerPatternEntropy,
  validateScannerPatternTable,
} from '../../../../src/core/scanner-patterns/scan.mts'

import type { PatternRule } from '@socketsecurity/scan-patterns'

function createRule(overrides: Partial<PatternRule> = {}): PatternRule {
  return {
    category: 'credentials',
    description: 'Finds a synthetic credential marker',
    dialect: 'js',
    id: 'example:credential',
    keywords: ['EXAMPLE_TOKEN'],
    kind: 'regex',
    provenance: {
      license: 'MIT',
      ruleId: 'credential',
      source: 'example-scanner@v1.0.0',
      sourceFile: 'rules/example.json',
    },
    regexFlags: '',
    regexSource: 'EXAMPLE_TOKEN_([A-Z0-9]+)',
    severity: 'high',
    title: 'Synthetic credential marker',
    ...overrides,
  }
}

describe('scanner pattern execution', () => {
  it('reports each match with stable source locations and no matched content', () => {
    const findings = findScannerPatternMatches(
      createRule(),
      'example.env',
      'safe=true\nEXAMPLE_TOKEN_DO_NOT_USE\nEXAMPLE_TOKEN_ALSO_FAKE',
    )
    expect(findings).toEqual([
      expect.objectContaining({ column: 1, file: 'example.env', line: 2 }),
      expect.objectContaining({ column: 1, file: 'example.env', line: 3 }),
    ])
    expect(JSON.stringify(findings)).not.toContain('DO_NOT_USE')
  })

  it('honors path, keyword, and entropy gates', () => {
    const rule = createRule({
      entropy: 2,
      kind: 'path',
      pathRegexSource: 'package\\.json$',
    })
    expect(
      findScannerPatternMatches(rule, 'README.md', 'EXAMPLE_TOKEN_ABC123'),
    ).toEqual([])
    expect(findScannerPatternMatches(rule, 'package.json', 'nothing')).toEqual(
      [],
    )
    expect(
      findScannerPatternMatches(rule, 'package.json', 'EXAMPLE_TOKEN_AAAAAA'),
    ).toEqual([])
    expect(
      findScannerPatternMatches(rule, 'package.json', 'EXAMPLE_TOKEN_A1B2C3'),
    ).toHaveLength(1)
  })

  it('classifies only JavaScript content rules as executable', () => {
    expect(isExecutableScannerPatternRule(createRule())).toBe(true)
    expect(isExecutableScannerPatternRule(createRule({ dialect: 're2' }))).toBe(
      false,
    )
    expect(
      isExecutableScannerPatternRule(
        createRule({ kind: 'audit', regexSource: undefined }),
      ),
    ).toBe(false)
    expect(
      isExecutableScannerPatternRule(
        createRule({ kind: 'capability', regexSource: undefined }),
      ),
    ).toBe(false)
  })

  it('computes Shannon entropy', () => {
    expect(scannerPatternEntropy('')).toBe(0)
    expect(scannerPatternEntropy('aaaaaaaa')).toBe(0)
    expect(scannerPatternEntropy('abcd')).toBe(2)
  })

  it('applies severity thresholds', () => {
    expect(isScannerPatternSeverityEnabled('critical', 'high')).toBe(true)
    expect(isScannerPatternSeverityEnabled('medium', 'high')).toBe(false)
    expect(isScannerPatternSeverityEnabled('info', undefined)).toBe(true)
  })

  it('rejects malformed published tables', () => {
    expect(() => validateScannerPatternTable({}, 'secrets')).toThrow(
      'Cannot load scanner patterns',
    )
  })

  it('scans text files with the published table and excludes binary files', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'scanner-pattern-runtime-'),
    )
    try {
      await writeFile(path.join(directory, 'example.txt'), 'ordinary content')
      await writeFile(
        path.join(directory, 'example.bin'),
        Buffer.from([0, 1, 2]),
      )
      const result = await scanWithScannerPatterns('secrets', [directory], {
        cwd: directory,
      })
      expect(result).toMatchObject({
        filesScanned: 1,
        findings: [],
        scanner: 'secrets',
      })
      expect(result.unsupportedRules.length).toBeGreaterThan(0)
    } finally {
      await safeDelete(directory, { maxRetries: 0 })
    }
  })
})
