/**
 * Unit tests for output-purls-deep-score markdown generation.
 *
 * Purpose: Tests markdown report generation for deep package security scores
 * across the NuGet, Maven, and Python ecosystems. Deep scores include
 * package + transitive dependencies. Uses snapshot testing to ensure
 * consistent report formatting.
 *
 * Related Files:
 *
 * - Src/commands/package/output-purls-deep-score.mts (implementation)
 * - Src/commands/package/fixtures/*.json (test fixtures)
 */

import { describe, expect, it } from 'vitest'

import mavenDeep from '../../../../src/commands/package/fixtures/maven_deep.json' with { type: 'json' }
import nugetDeep from '../../../../src/commands/package/fixtures/nuget_deep.json' with { type: 'json' }
import pythonDeep from '../../../../src/commands/package/fixtures/python_deep.json' with { type: 'json' }
import { createMarkdownReport } from '../../../../src/commands/package/output-purls-deep-score.mts'

describe('package score output', async () => {
  describe('nuget', () => {
    it('should report deep as markdown', () => {
      const txt = createMarkdownReport(nugetDeep.data, [])
      expect(txt).toMatchInlineSnapshot(`
        "# Complete Package Score

        This is a Socket report for the package *"pkg:nuget/needpluscommonlibrary@1.0.0"* and its *3* direct/transitive dependencies.

        It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.

        The report should give you a good insight into the status of this package.

        ## Package itself

        Here are results for the package itself (excluding data from dependencies).

        ### Shallow Score

        This score is just for the package itself:

        - Overall: 100
        - Maintenance: 100
        - Quality: 100
        - Supply Chain: 100
        - Vulnerability: 100
        - License: 100

        ### Capabilities

        No capabilities were found in the package.

        ### Alerts for this package

        There are currently no alerts for this package.

        ## Transitive Package Results

        Here are results for the package and its direct/transitive dependencies.

        ### Deep Score

        This score represents the package and and its direct/transitive dependencies:
        The function used to calculate the values in aggregate is: *"min"*

        - Overall: 84
        - Maintenance: 100
        - Quality: 88
        - Supply Chain: 89
        - Vulnerability: 84
        - License: 100

        ### Lowest Scoring Package Per Category

        These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.

        - Overall: nuget/newtonsoft.json@4.5.10
        - Maintenance: nuget/dotnetzip@1.9.1.8
        - Quality: nuget/dotnetzip@1.9.1.8
        - Supply Chain: nuget/nlog@2.0.0.2000
        - Vulnerability: nuget/newtonsoft.json@4.5.10
        - License: nuget/dotnetzip@1.9.1.8

        ### Capabilities

        These are the capabilities detected in at least one package:

        - eval
        - fs
        - net
        - shell
        - unsafe

        ### Alerts

        These are the alerts found:

        | -------- | ------------------- | ---------------------------- |
        | Severity | Alert Name          | Example package reporting it |
        | -------- | ------------------- | ---------------------------- |
        | high     | cve                 | nuget/newtonsoft.json@4.5.10 |
        | middle   | mediumCVE           | nuget/dotnetzip@1.9.1.8      |
        | middle   | networkAccess       | nuget/nlog@2.0.0.2000        |
        | middle   | shellAccess         | nuget/dotnetzip@1.9.1.8      |
        | middle   | usesEval            | nuget/dotnetzip@1.9.1.8      |
        | low      | filesystemAccess    | nuget/dotnetzip@1.9.1.8      |
        | low      | unidentifiedLicense | nuget/dotnetzip@1.9.1.8      |
        | -------- | ------------------- | ---------------------------- |
        "
      `)
    })
  })

  describe('maven', () => {
    it('should report deep as markdown', () => {
      const txt = createMarkdownReport(mavenDeep.data, [])
      expect(txt).toMatchInlineSnapshot(`
        "# Complete Package Score

        This is a Socket report for the package *"pkg:maven/org.apache.beam/beam-runners-flink-1.15-job-server@2.58.0?classifier=tests&ext=jar"* and its *404* direct/transitive dependencies.

        It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.

        The report should give you a good insight into the status of this package.

        ## Package itself

        Here are results for the package itself (excluding data from dependencies).

        ### Shallow Score

        This score is just for the package itself:

        - Overall: 100
        - Maintenance: 100
        - Quality: 100
        - Supply Chain: 100
        - Vulnerability: 100
        - License: 100

        ### Capabilities

        No capabilities were found in the package.

        ### Alerts for this package

        There are currently no alerts for this package.

        ## Transitive Package Results

        Here are results for the package and its direct/transitive dependencies.

        ### Deep Score

        This score represents the package and and its direct/transitive dependencies:
        The function used to calculate the values in aggregate is: *"min"*

        - Overall: 6
        - Maintenance: 71
        - Quality: 88
        - Supply Chain: 6
        - Vulnerability: 25
        - License: 50

        ### Lowest Scoring Package Per Category

        These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.

        - Overall: maven/io.trino.hadoop/hadoop-apache@3.2.0-12
        - Maintenance: maven/org.apache.beam/beam-sdks-java-extensions-arrow@2.58.0
        - Quality: maven/log4j/log4j@1.2.17
        - Supply Chain: maven/io.trino.hadoop/hadoop-apache@3.2.0-12
        - Vulnerability: maven/log4j/log4j@1.2.17
        - License: maven/com.fasterxml.jackson.datatype/jackson-datatype-joda@2.15.4

        ### Capabilities

        These are the capabilities detected in at least one package:

        - env
        - eval
        - fs
        - net
        - shell
        - unsafe

        ### Alerts

        These are the alerts found:

        | -------- | ---------------------- | ---------------------------------------------------- |
        | Severity | Alert Name             | Example package reporting it                         |
        | -------- | ---------------------- | ---------------------------------------------------- |
        | critical | criticalCVE            | maven/log4j/log4j@1.2.17                             |
        | critical | didYouMean             | maven/io.trino.hadoop/hadoop-apache@3.2.0-12         |
        | high     | cve                    | maven/log4j/log4j@1.2.17                             |
        | middle   | hasNativeCode          | maven/org.apache.beam/beam-vendor-grpc-1_60_1@0.2    |
        | middle   | mediumCVE              | maven/org.apache.ant/ant@1.10.9                      |
        | middle   | networkAccess          | maven/log4j/log4j@1.2.17                             |
        | middle   | potentialVulnerability | maven/log4j/log4j@1.2.17                             |
        | middle   | shellAccess            | maven/org.apache.beam/beam-vendor-calcite-1_28_0@0.2 |
        | middle   | usesEval               | maven/log4j/log4j@1.2.17                             |
        | low      | copyleftLicense        | maven/javax.annotation/javax.annotation-api@1.3.2    |
        | low      | envVars                | maven/org.apache.beam/beam-vendor-calcite-1_28_0@0.2 |
        | low      | filesystemAccess       | maven/log4j/log4j@1.2.17                             |
        | low      | gptAnomaly             | maven/io.netty/netty-transport@4.1.100.Final         |
        | low      | licenseException       | maven/javax.annotation/javax.annotation-api@1.3.2    |
        | low      | mildCVE                | maven/org.apache.hadoop/hadoop-common@2.10.2         |
        | low      | noLicenseFound         | maven/com.google.guava/failureaccess@1.0.2           |
        | low      | nonpermissiveLicense   | maven/org.apache.commons/commons-math3@3.6.1         |
        | low      | unidentifiedLicense    | maven/log4j/log4j@1.2.17                             |
        | low      | unmaintained           | maven/log4j/log4j@1.2.17                             |
        | -------- | ---------------------- | ---------------------------------------------------- |
        "
      `)
    })
  })

  describe('python', () => {
    it('should report deep as markdown', () => {
      const txt = createMarkdownReport(pythonDeep.data, [])
      expect(txt).toMatchInlineSnapshot(`
        "# Complete Package Score

        This is a Socket report for the package *"pkg:pypi/discordpydebug@0.0.4?artifact_id=tar-gz"* and its *825* direct/transitive dependencies.

        It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.

        The report should give you a good insight into the status of this package.

        ## Package itself

        Here are results for the package itself (excluding data from dependencies).

        ### Shallow Score

        This score is just for the package itself:

        - Overall: 100
        - Maintenance: 100
        - Quality: 100
        - Supply Chain: 100
        - Vulnerability: 100
        - License: 100

        ### Capabilities

        No capabilities were found in the package.

        ### Alerts for this package

        There are currently no alerts for this package.

        ## Transitive Package Results

        Here are results for the package and its direct/transitive dependencies.

        ### Deep Score

        This score represents the package and and its direct/transitive dependencies:
        The function used to calculate the values in aggregate is: *"min"*

        - Overall: 70
        - Maintenance: 99
        - Quality: 88
        - Supply Chain: 70
        - Vulnerability: 100
        - License: 70

        ### Lowest Scoring Package Per Category

        These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.

        - Overall: pypi/virtualenv@20.31.2
        - Maintenance: pypi/webencodings@0.5.1
        - Quality: pypi/coverage-enable-subprocess@1.0
        - Supply Chain: pypi/virtualenv@20.31.2
        - Vulnerability: pypi/chardet@5.2.0
        - License: pypi/chardet@5.2.0

        ### Capabilities

        These are the capabilities detected in at least one package:

        - env
        - eval
        - fs
        - net
        - shell
        - unsafe
        - url

        ### Alerts

        These are the alerts found:

        | -------- | -------------------- | ----------------------------- |
        | Severity | Alert Name           | Example package reporting it  |
        | -------- | -------------------- | ----------------------------- |
        | middle   | gptDidYouMean        | pypi/jinja2@3.1.6             |
        | middle   | hasNativeCode        | pypi/pyyaml@6.0.2             |
        | middle   | networkAccess        | pypi/webencodings@0.5.1       |
        | middle   | shellAccess          | pypi/colorama@0.4.6           |
        | middle   | usesEval             | pypi/stack-data@0.6.3         |
        | low      | ambiguousClassifier  | pypi/jinja2@3.1.6             |
        | low      | copyleftLicense      | pypi/chardet@5.2.0            |
        | low      | envVars              | pypi/sphinxcontrib-jquery@4.1 |
        | low      | filesystemAccess     | pypi/chardet@5.2.0            |
        | low      | gptAnomaly           | pypi/genshi@0.7.9             |
        | low      | licenseException     | pypi/pygments@2.19.1          |
        | low      | nonpermissiveLicense | pypi/chardet@5.2.0            |
        | low      | unidentifiedLicense  | pypi/webencodings@0.5.1       |
        | low      | unmaintained         | pypi/webencodings@0.5.1       |
        | -------- | -------------------- | ----------------------------- |
        "
      `)
    })
  })
})
