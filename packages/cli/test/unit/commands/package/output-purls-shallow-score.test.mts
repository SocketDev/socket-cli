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
 * - Src/commands/package/fixtures/*.json, test fixtures
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
        \u001B[1mShallow Package Score\u001B[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: \u001B[1mpkg:npm/bowserify@10.2.1\u001B[22m

        - Supply Chain Risk:  \u001B[31m 36\u001B[39m
        - Maintenance:       \u001B[33m 75\u001B[39m
        - Quality:           \u001B[32m 99\u001B[39m
        - Vulnerabilities:   \u001B[32m100\u001B[39m
        - License:           \u001B[32m100\u001B[39m
        - Alerts (\u001B[31m2\u001B[39m/\u001B[33m2\u001B[39m/4):     \u001B[31m\u001B[2m[critical] \u001B[22mdidYouMean\u001B[39m, \u001B[31m\u001B[2m[high] \u001B[22mtroll\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mnetworkAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22munpopularPackage\u001B[39m, \u001B[2m[low] \u001B[22mdebugAccess, \u001B[2m[low] \u001B[22mdynamicRequire, \u001B[2m[low] \u001B[22mfilesystemAccess, and \u001B[2m[low] \u001B[22munmaintained
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
        \u001B[1mShallow Package Score\u001B[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: \u001B[1mpkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60\u001B[22m

        - Supply Chain Risk:  \u001B[31m 39\u001B[39m
        - Maintenance:       \u001B[32m100\u001B[39m
        - Quality:           \u001B[32m100\u001B[39m
        - Vulnerabilities:   \u001B[32m100\u001B[39m
        - License:           \u001B[32m100\u001B[39m
        - Alerts (\u001B[31m1\u001B[39m/\u001B[33m3\u001B[39m/2):     \u001B[31m\u001B[2m[critical] \u001B[22mmalware\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mnetworkAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mshellAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22musesEval\u001B[39m, \u001B[2m[low] \u001B[22menvVars, and \u001B[2m[low] \u001B[22mfilesystemAccess
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
        \u001B[1mShallow Package Score\u001B[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: \u001B[1mpkg:gem/plaid@14.11.0\u001B[22m

        - Supply Chain Risk:  \u001B[32m 86\u001B[39m
        - Maintenance:       \u001B[32m100\u001B[39m
        - Quality:           \u001B[32m100\u001B[39m
        - Vulnerabilities:   \u001B[32m100\u001B[39m
        - License:           \u001B[32m100\u001B[39m
        - Alerts (\u001B[31m2\u001B[39m/\u001B[33m3\u001B[39m/2):     \u001B[31m\u001B[2m[high] \u001B[22mgptMalware\u001B[39m, \u001B[31m\u001B[2m[high] \u001B[22mobfuscatedFile\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mnetworkAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mshellAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22musesEval\u001B[39m, \u001B[2m[low] \u001B[22menvVars, and \u001B[2m[low] \u001B[22mfilesystemAccess
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
        \u001B[1mShallow Package Score\u001B[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: \u001B[1mpkg:nuget/needpluscommonlibrary@1.0.0\u001B[22m

        - Supply Chain Risk:  \u001B[32m 91\u001B[39m
        - Maintenance:       \u001B[32m100\u001B[39m
        - Quality:           \u001B[32m 86\u001B[39m
        - Vulnerabilities:   \u001B[32m100\u001B[39m
        - License:           \u001B[32m100\u001B[39m
        - Alerts (\u001B[31m0\u001B[39m/\u001B[33m4\u001B[39m/2):     \u001B[33m\u001B[2m[middle] \u001B[22mnetworkAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mshellAccess\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22munpopularPackage\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22musesEval\u001B[39m, \u001B[2m[low] \u001B[22mfilesystemAccess, and \u001B[2m[low] \u001B[22munidentifiedLicense
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
        \u001B[1mShallow Package Score\u001B[22m

        Please note: The listed scores are ONLY for the package itself. It does NOT
                     reflect the scores of any dependencies, transitive or otherwise.


        Package: \u001B[1mpkg:maven/org.apache.beam/beam-runners-flink-1.15-job-server@2.58.0\u001B[22m

        - Supply Chain Risk:  \u001B[33m 67\u001B[39m
        - Maintenance:       \u001B[32m100\u001B[39m
        - Quality:           \u001B[32m100\u001B[39m
        - Vulnerabilities:   \u001B[32m100\u001B[39m
        - License:           \u001B[33m 60\u001B[39m
        - Alerts (\u001B[31m0\u001B[39m/\u001B[33m3\u001B[39m/0):     \u001B[33m\u001B[2m[middle] \u001B[22mhasNativeCode\u001B[39m, \u001B[33m\u001B[2m[middle] \u001B[22mnetworkAccess\u001B[39m, and \u001B[33m\u001B[2m[middle] \u001B[22musesEval\u001B[39m
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
