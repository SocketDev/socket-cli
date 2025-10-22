import { describe, expect, it } from 'vitest'

import goShallow from './fixtures/go_shallow.json'
import mavenShallow from './fixtures/maven_shallow.json'
import npmShallow from './fixtures/npm_shallow.json'
import nugetShallow from './fixtures/nuget_shallow.json'
import pythonDupes from './fixtures/python_dupes.json'
import pythonShallow from './fixtures/python_shallow.json'
import rubyShallow from './fixtures/ruby_shallow.json'
import {
  generateMarkdownReport,
  generateTextReport,
  preProcess,
} from './output-purls-shallow-score.mts'

describe('package score output', async () => {
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


        Package: [1mpkg:golang/tlsproxy@v0.0.0-20250304082521-29051ed19c60[22m

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



        ## Package: pkg:golang/tlsproxy@v0.0.0-20250304082521-29051ed19c60

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


        Package: [1mpkg:maven/beam-runners-flink-1.15-job-server@2.58.0[22m

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



        ## Package: pkg:maven/beam-runners-flink-1.15-job-server@2.58.0

        - Supply Chain Risk:   67
        - Maintenance:       100
        - Quality:           100
        - Vulnerabilities:   100
        - License:            60
        - Alerts (0/3/0):     [middle] hasNativeCode, [middle] networkAccess, and [middle] usesEval"
      `)
    })
  })

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
})
