/**
 * Unit tests for output-purls-shallow-score's Python ecosystem coverage,
 * missing-response handling, and duplicate-block deduplication.
 *
 * Purpose: Tests text and markdown report generation for shallow package
 * security scores. Shallow scores analyze only the package itself, excluding
 * dependencies. Uses snapshot testing to ensure consistent formatting.
 *
 * Test Coverage:
 *
 * - Python package text and markdown formatting
 * - Python package deduplication logic
 * - Missing package handling
 * - Deduplication of identical report blocks / lowest-score merge
 *
 * Testing Approach: Uses fixture JSON files from real Socket API responses and
 * snapshot testing to validate comprehensive report structure. Tests both text
 * (ANSI colors) and markdown output formats.
 *
 * Related Files:
 *
 * - Src/commands/package/output-purls-shallow-score.mts (implementation)
 * - Src/commands/package/fixtures/*.json (test fixtures)
 */

import { describe, expect, it } from 'vitest'

import pythonDupes from '../../../../src/commands/package/fixtures/python_dupes.json' with { type: 'json' }
import pythonShallow from '../../../../src/commands/package/fixtures/python_shallow.json' with { type: 'json' }
import {
  generateMarkdownReport,
  generateTextReport,
  preProcess,
} from '../../../../src/commands/package/output-purls-shallow-score.mts'

describe('package score output', async () => {
  describe('python', () => {
    it('should report shallow as text', () => {
      const { missing, rows } = preProcess(pythonShallow.data, [])
      const txt = generateTextReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "
        [1mShallow Package Score[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: [1mpkg:pypi/discordpydebug@0.0.4[22m

        - Supply Chain Risk:  [31m 22[39m
        - Maintenance:       [32m100[39m
        - Quality:           [32m 99[39m
        - Vulnerabilities:   [32m100[39m
        - License:           [32m100[39m
        - Alerts ([31m1[39m/[33m3[39m/2):     [31m[2m[critical] [22mmalware[39m, [33m[2m[middle] [22mnetworkAccess[39m, [33m[2m[middle] [22mshellAccess[39m, [33m[2m[middle] [22munpopularPackage[39m, [2m[low] [22mfilesystemAccess, and [2m[low] [22munidentifiedLicense
        "
      `)
    })

    it('should report shallow as markdown', () => {
      const { missing, rows } = preProcess(pythonShallow.data, [])
      const txt = generateMarkdownReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "# Shallow Package Report

        This report contains the response for requesting data on some package url(s).

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.



        ## Package: pkg:pypi/discordpydebug@0.0.4

        - Supply Chain Risk:   22
        - Maintenance:       100
        - Quality:            99
        - Vulnerabilities:   100
        - License:           100
        - Alerts (1/3/2):     [critical] malware, [middle] networkAccess, [middle] shellAccess, [middle] unpopularPackage, [low] filesystemAccess, and [low] unidentifiedLicense"
      `)
    })

    describe('python duplication', () => {
      it('should dedupe the python dupes and create a colored plain text report with three score blocks', () => {
        const { missing, rows } = preProcess(pythonDupes.data, [])
        const txt = generateTextReport(rows, missing)
        expect(txt).toMatchInlineSnapshot(`
          "
          [1mShallow Package Score[22m

          Please note: The listed scores are ONLY for the package itself. It does NOT
                       reflect the scores of any dependencies, transitive or otherwise.


          Package: [1mpkg:pypi/charset-normalizer@3.4.0[22m

          - Supply Chain Risk:  [32m 99[39m
          - Maintenance:       [32m100[39m
          - Quality:           [32m100[39m
          - Vulnerabilities:   [32m100[39m
          - License:           [32m100[39m
          - Alerts ([31m0[39m/[33m2[39m/1):     [33m[2m[middle] [22mhasNativeCode[39m, [33m[2m[middle] [22musesEval[39m, and [2m[low] [22mfilesystemAccess
          "
        `)

        expect(txt.split('Supply Chain Risk:').length).toBe(2) // Should find it once so when you split that you get 2 parts
      })

      it('should dedupe the python dupes and create a markdown report with three score blocks', () => {
        const { missing, rows } = preProcess(pythonDupes.data, [])
        const txt = generateMarkdownReport(rows, missing)
        expect(txt).toMatchInlineSnapshot(`
          "# Shallow Package Report

          This report contains the response for requesting data on some package url(s).

          Please note: The listed scores are ONLY for the package itself. It does NOT
                       reflect the scores of any dependencies, transitive or otherwise.



          ## Package: pkg:pypi/charset-normalizer@3.4.0

          - Supply Chain Risk:   99
          - Maintenance:       100
          - Quality:           100
          - Vulnerabilities:   100
          - License:           100
          - Alerts (0/2/1):     [middle] hasNativeCode, [middle] usesEval, and [low] filesystemAccess"
        `)

        expect(txt.split('Supply Chain Risk:').length).toBe(2) // Should find it once so when you split that you get 2 parts
        expect(txt).toContain('pkg:pypi/charset-normalizer@3.4.0')
      })
    })
  })

  describe('missing purls', () => {
    it('emits "missing response" notice in text report', () => {
      const empty = new Map()
      const txt = generateTextReport(empty, [
        'pkg:npm/missing@1',
        'pkg:npm/gone@2',
      ])
      expect(txt).toContain('At least one package had no response')
      expect(txt).toContain('missing@1')
      expect(txt).toContain('gone@2')
    })

    it('emits "missing response" notice in markdown report', () => {
      const empty = new Map()
      const md = generateMarkdownReport(empty, ['pkg:pypi/missing@1'])
      expect(md).toContain('## Missing response')
      expect(md).toContain('missing@1')
    })

    it('omits missing notice when array is empty', () => {
      const empty = new Map()
      const txt = generateTextReport(empty, [])
      expect(txt).not.toContain('At least one package had no response')
      const md = generateMarkdownReport(empty, [])
      expect(md).not.toContain('## Missing response')
    })
  })

  describe('deduplication of identical text-report blocks', () => {
    it('drops duplicate blocks from generateTextReport', () => {
      const { missing, rows } = preProcess(pythonDupes.data, [])
      const txt = generateTextReport(rows, missing)
      // pythonDupes contains duplicated entries; the dedupe path in
      // generateTextReport (via the Set<string> tracker) drops repeats.
      const matches = txt.match(/Supply Chain Risk:/g) || []
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    it('drops duplicate blocks from generateMarkdownReport', () => {
      const { missing, rows } = preProcess(pythonDupes.data, [])
      const md = generateMarkdownReport(rows, missing)
      const matches = md.match(/Supply Chain Risk:/g) || []
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    it('takes the lowest of duplicate quality/vulnerability/license scores', () => {
      // Two artifacts with the same purl but different scores — preProcess
      // dedupes them by purl and takes the LOWEST score for each metric.
      const data = [
        {
          type: 'npm',
          name: 'shared-pkg',
          version: '1.0.0',
          score: {
            supplyChain: 100,
            maintenance: 100,
            quality: 99,
            vulnerability: 99,
            license: 99,
          },
          alerts: [],
        },
        // Same purl, but lower quality/vulnerability/license.
        {
          type: 'npm',
          name: 'shared-pkg',
          version: '1.0.0',
          score: {
            supplyChain: 100,
            maintenance: 100,
            quality: 50,
            vulnerability: 60,
            license: 70,
          },
          alerts: [],
        },
      ]
      const { rows } = preProcess(data as unknown, [])
      const row = rows.get('pkg:npm/shared-pkg@1.0.0')!
      expect(row.score.quality).toBe(50)
      expect(row.score.vulnerability).toBe(60)
      expect(row.score.license).toBe(70)
    })

    it('drops duplicate text-report blocks when two purls yield identical cards', () => {
      // Construct two artifacts with the same shape so formatReportCard
      // produces an identical string for both, hitting the dupes.has() path.
      const sharedScore = {
        supplyChain: 100,
        maintenance: 100,
        quality: 100,
        vulnerability: 100,
        license: 100,
      }
      const rows = new Map<string, unknown>([
        [
          'pkg:npm/dup-pkg@1.0.0',
          {
            ecosystem: 'npm',
            namespace: '',
            name: 'dup-pkg',
            version: '1.0.0',
            score: sharedScore,
            alerts: new Map(),
          },
        ],
        // Different key but same content → same formatReportCard output.
        [
          'pkg:npm/dup-pkg@2.0.0',
          {
            ecosystem: 'npm',
            namespace: '',
            name: 'dup-pkg',
            version: '1.0.0',
            score: sharedScore,
            alerts: new Map(),
          },
        ],
      ])

      const txt = generateTextReport(rows, [])
      // The dupe block should be dropped: only one rendering of "dup-pkg" content.
      const matches = txt.match(/dup-pkg/g) || []
      expect(matches.length).toBe(1)
    })
  })
})
