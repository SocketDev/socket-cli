/**
 * Unit tests for output-purls-shallow-score report generation.
 *
 * Purpose: Tests text and markdown report generation for shallow package
 * security scores across multiple ecosystems. Shallow scores analyze only the
 * package itself, excluding dependencies. Uses snapshot testing to ensure
 * consistent formatting across npm, Go, Ruby, NuGet, and Maven ecosystems.
 *
 * Test Coverage:
 *
 * - Npm package text and markdown formatting
 * - Go package text and markdown formatting
 * - Ruby package text and markdown formatting
 * - NuGet package text and markdown formatting
 * - Maven package text and markdown formatting
 * - Score color coding (red/yellow/green thresholds)
 * - Alert severity grouping and display
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

import goShallow from '../../../../src/commands/package/fixtures/go_shallow.json' with { type: 'json' }
import mavenShallow from '../../../../src/commands/package/fixtures/maven_shallow.json' with { type: 'json' }
import npmShallow from '../../../../src/commands/package/fixtures/npm_shallow.json' with { type: 'json' }
import nugetShallow from '../../../../src/commands/package/fixtures/nuget_shallow.json' with { type: 'json' }
import rubyShallow from '../../../../src/commands/package/fixtures/ruby_shallow.json' with { type: 'json' }
import {
  formatReportCard,
  generateMarkdownReport,
  generateTextReport,
  preProcess,
} from '../../../../src/commands/package/output-purls-shallow-score.mts'

import type { DedupedArtifact } from '../../../../src/commands/package/output-purls-shallow-score.mts'

describe('package score output', async () => {
  describe('namespaced packages in shallow report purl', () => {
    function makeArtifact(
      overrides: Partial<DedupedArtifact>,
    ): DedupedArtifact {
      return {
        ecosystem: 'npm',
        namespace: '',
        name: 'react',
        version: '4.11.0',
        score: {
          supplyChain: 99,
          maintenance: 95,
          quality: 100,
          vulnerability: 100,
          license: 70,
        },
        alerts: new Map(),
        ...overrides,
      }
    }

    it('should include the npm namespace in the reported purl', () => {
      const card = formatReportCard(makeArtifact({ namespace: '@axe-core' }), {
        colorize: false,
      })
      // Regression: the namespace was dropped, so the card reported
      // `pkg:npm/react@4.11.0` instead of `pkg:npm/@axe-core/react@4.11.0`.
      expect(card).toContain('Package: pkg:npm/@axe-core/react@4.11.0')
      expect(card).not.toContain('Package: pkg:npm/react@4.11.0')
    })

    it('should omit the namespace segment when there is none', () => {
      const card = formatReportCard(makeArtifact({ name: 'express' }), {
        colorize: false,
      })
      expect(card).toContain('Package: pkg:npm/express@4.11.0')
    })
  })

  describe('npm', () => {
    it('should report shallow as text', () => {
      const { missing, rows } = preProcess(npmShallow.data, [])
      const txt = generateTextReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "
        [1mShallow Package Score[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: [1mpkg:npm/bowserify@10.2.1[22m

        - Supply Chain Risk:  [31m 36[39m
        - Maintenance:       [33m 75[39m
        - Quality:           [32m 99[39m
        - Vulnerabilities:   [32m100[39m
        - License:           [32m100[39m
        - Alerts ([31m2[39m/[33m2[39m/4):     [31m[2m[critical] [22mdidYouMean[39m, [31m[2m[high] [22mtroll[39m, [33m[2m[middle] [22mnetworkAccess[39m, [33m[2m[middle] [22munpopularPackage[39m, [2m[low] [22mdebugAccess, [2m[low] [22mdynamicRequire, [2m[low] [22mfilesystemAccess, and [2m[low] [22munmaintained
        "
      `)
    })

    it('should report shallow as markdown', () => {
      const { missing, rows } = preProcess(npmShallow.data, [])
      const txt = generateMarkdownReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "# Shallow Package Report

        This report contains the response for requesting data on some package url(s).

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.



        ## Package: pkg:npm/bowserify@10.2.1

        - Supply Chain Risk:   36
        - Maintenance:        75
        - Quality:            99
        - Vulnerabilities:   100
        - License:           100
        - Alerts (2/2/4):     [critical] didYouMean, [high] troll, [middle] networkAccess, [middle] unpopularPackage, [low] debugAccess, [low] dynamicRequire, [low] filesystemAccess, and [low] unmaintained"
      `)
    })
  })

  describe('go', () => {
    it('should report shallow as text', () => {
      const { missing, rows } = preProcess(goShallow.data, [])
      const txt = generateTextReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "
        [1mShallow Package Score[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: [1mpkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60[22m

        - Supply Chain Risk:  [31m 39[39m
        - Maintenance:       [32m100[39m
        - Quality:           [32m100[39m
        - Vulnerabilities:   [32m100[39m
        - License:           [32m100[39m
        - Alerts ([31m1[39m/[33m3[39m/2):     [31m[2m[critical] [22mmalware[39m, [33m[2m[middle] [22mnetworkAccess[39m, [33m[2m[middle] [22mshellAccess[39m, [33m[2m[middle] [22musesEval[39m, [2m[low] [22menvVars, and [2m[low] [22mfilesystemAccess
        "
      `)
    })

    it('should report shallow as markdown', () => {
      const { missing, rows } = preProcess(goShallow.data, [])
      const txt = generateMarkdownReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "# Shallow Package Report

        This report contains the response for requesting data on some package url(s).

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.



        ## Package: pkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60

        - Supply Chain Risk:   39
        - Maintenance:       100
        - Quality:           100
        - Vulnerabilities:   100
        - License:           100
        - Alerts (1/3/2):     [critical] malware, [middle] networkAccess, [middle] shellAccess, [middle] usesEval, [low] envVars, and [low] filesystemAccess"
      `)
    })
  })

  describe('ruby', () => {
    it('should report shallow as text', () => {
      const { missing, rows } = preProcess(rubyShallow.data, [])
      const txt = generateTextReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "
        [1mShallow Package Score[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: [1mpkg:gem/plaid@14.11.0[22m

        - Supply Chain Risk:  [32m 86[39m
        - Maintenance:       [32m100[39m
        - Quality:           [32m100[39m
        - Vulnerabilities:   [32m100[39m
        - License:           [32m100[39m
        - Alerts ([31m2[39m/[33m3[39m/2):     [31m[2m[high] [22mgptMalware[39m, [31m[2m[high] [22mobfuscatedFile[39m, [33m[2m[middle] [22mnetworkAccess[39m, [33m[2m[middle] [22mshellAccess[39m, [33m[2m[middle] [22musesEval[39m, [2m[low] [22menvVars, and [2m[low] [22mfilesystemAccess
        "
      `)
    })

    it('should report shallow as markdown', () => {
      const { missing, rows } = preProcess(rubyShallow.data, [])
      const txt = generateMarkdownReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "# Shallow Package Report

        This report contains the response for requesting data on some package url(s).

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.



        ## Package: pkg:gem/plaid@14.11.0

        - Supply Chain Risk:   86
        - Maintenance:       100
        - Quality:           100
        - Vulnerabilities:   100
        - License:           100
        - Alerts (2/3/2):     [high] gptMalware, [high] obfuscatedFile, [middle] networkAccess, [middle] shellAccess, [middle] usesEval, [low] envVars, and [low] filesystemAccess"
      `)
    })
  })

  describe('nuget', () => {
    it('should report shallow as text', () => {
      const { missing, rows } = preProcess(nugetShallow.data, [])
      const txt = generateTextReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "
        [1mShallow Package Score[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: [1mpkg:nuget/needpluscommonlibrary@1.0.0[22m

        - Supply Chain Risk:  [32m 91[39m
        - Maintenance:       [32m100[39m
        - Quality:           [32m 86[39m
        - Vulnerabilities:   [32m100[39m
        - License:           [32m100[39m
        - Alerts ([31m0[39m/[33m4[39m/2):     [33m[2m[middle] [22mnetworkAccess[39m, [33m[2m[middle] [22mshellAccess[39m, [33m[2m[middle] [22munpopularPackage[39m, [33m[2m[middle] [22musesEval[39m, [2m[low] [22mfilesystemAccess, and [2m[low] [22munidentifiedLicense
        "
      `)
    })

    it('should report shallow as markdown', () => {
      const { missing, rows } = preProcess(nugetShallow.data, [])
      const txt = generateMarkdownReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "# Shallow Package Report

        This report contains the response for requesting data on some package url(s).

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.



        ## Package: pkg:nuget/needpluscommonlibrary@1.0.0

        - Supply Chain Risk:   91
        - Maintenance:       100
        - Quality:            86
        - Vulnerabilities:   100
        - License:           100
        - Alerts (0/4/2):     [middle] networkAccess, [middle] shellAccess, [middle] unpopularPackage, [middle] usesEval, [low] filesystemAccess, and [low] unidentifiedLicense"
      `)
    })
  })

  describe('maven', () => {
    it('should report shallow as text', () => {
      const { missing, rows } = preProcess(mavenShallow.data, [])
      const txt = generateTextReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "
        [1mShallow Package Score[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: [1mpkg:maven/org.apache.beam/beam-runners-flink-1.15-job-server@2.58.0[22m

        - Supply Chain Risk:  [33m 67[39m
        - Maintenance:       [32m100[39m
        - Quality:           [32m100[39m
        - Vulnerabilities:   [32m100[39m
        - License:           [33m 60[39m
        - Alerts ([31m0[39m/[33m3[39m/0):     [33m[2m[middle] [22mhasNativeCode[39m, [33m[2m[middle] [22mnetworkAccess[39m, and [33m[2m[middle] [22musesEval[39m
        "
      `)
    })

    it('should report shallow as markdown', () => {
      const { missing, rows } = preProcess(mavenShallow.data, [])
      const txt = generateMarkdownReport(rows, missing)
      expect(txt).toMatchInlineSnapshot(`
        "# Shallow Package Report

        This report contains the response for requesting data on some package url(s).

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.



        ## Package: pkg:maven/org.apache.beam/beam-runners-flink-1.15-job-server@2.58.0

        - Supply Chain Risk:   67
        - Maintenance:       100
        - Quality:           100
        - Vulnerabilities:   100
        - License:            60
        - Alerts (0/3/0):     [middle] hasNativeCode, [middle] networkAccess, and [middle] usesEval"
      `)
    })
  })
})
