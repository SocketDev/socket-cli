import { describe, expect, it } from 'vitest'

import goDeep from './fixtures/go_deep.json'
import mavenDeep from './fixtures/maven_deep.json'
import npmDeep from './fixtures/npm_deep.json'
import nugetDeep from './fixtures/nuget_deep.json'
import pythonDeep from './fixtures/python_deep.json'
import rubyDeep from './fixtures/ruby_deep.json'
import { createMarkdownReport } from './output-purls-deep-score.mts'

describe('package score output', async () => {
  describe('npm', () => {
    it('should report deep as markdown', () => {
      const txt = createMarkdownReport(npmDeep.data, [])
      expect(txt).toMatchInlineSnapshot(`
        "# Complete Package Score

        This is a Socket report for the package *"npm/bowserify@10.2.1"* and its *171* direct/transitive dependencies.

        It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.

        The report should give you a good insight into the status of this package.

        ## Package itself

        Here are results for the package itself (excluding data from dependencies).

        ### Shallow Score

        This score is just for the package itself:

        - Overall: 35
        - Maintenance: 74
        - Quality: 99
        - Supply Chain: 35
        - Vulnerability: 100
        - License: 100

        ### Capabilities

        These are the capabilities detected in the package itself:

        - fs
        - net
        - unsafe
        - url

        ### Alerts for this package

        These are the alerts found for the package itself:

        | -------- | ---------------- |
        | Severity | Alert Name       |
        | -------- | ---------------- |
        | critical | didYouMean       |
        | high     | troll            |
        | middle   | networkAccess    |
        | middle   | unpopularPackage |
        | low      | debugAccess      |
        | low      | dynamicRequire   |
        | low      | filesystemAccess |
        | low      | unmaintained     |
        | -------- | ---------------- |

        ## Transitive Package Results

        Here are results for the package and its direct/transitive dependencies.

        ### Deep Score

        This score represents the package and and its direct/transitive dependencies:
        The function used to calculate the values in aggregate is: *"min"*

        - Overall: 25
        - Maintenance: 50
        - Quality: 49
        - Supply Chain: 35
        - Vulnerability: 25
        - License: 80

        ### Capabilities

        These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.

        - Overall: npm/shell-quote@0.0.1
        - Maintenance: npm/jsonify@0.0.1
        - Quality: npm/tty-browserify@0.0.1
        - Supply Chain: npm/bowserify@10.2.1
        - Vulnerability: npm/shell-quote@0.0.1
        - License: npm/acorn-node@1.8.2

        ### Capabilities

        These are the capabilities detected in at least one package:

        - env
        - eval
        - fs
        - net
        - unsafe
        - url

        ### Alerts

        These are the alerts found:

        | -------- | ---------------------- | ---------------------------- |
        | Severity | Alert Name             | Example package reporting it |
        | -------- | ---------------------- | ---------------------------- |
        | critical | criticalCVE            | npm/shell-quote@0.0.1        |
        | critical | didYouMean             | npm/bowserify@10.2.1         |
        | high     | cve                    | npm/minimatch@2.0.10         |
        | high     | socketUpgradeAvailable | npm/safe-buffer@5.1.2        |
        | high     | troll                  | npm/bowserify@10.2.1         |
        | middle   | deprecated             | npm/querystring@0.2.0        |
        | middle   | miscLicenseIssues      | npm/duplexer2@0.0.2          |
        | middle   | missingAuthor          | npm/indexof@0.0.1            |
        | middle   | networkAccess          | npm/https-browserify@0.0.1   |
        | middle   | trivialPackage         | npm/tty-browserify@0.0.1     |
        | middle   | unpopularPackage       | npm/b@1.0.0                  |
        | middle   | usesEval               | npm/syntax-error@1.4.0       |
        | low      | debugAccess            | npm/asn1.js@4.10.1           |
        | low      | dynamicRequire         | npm/module-deps@3.9.1        |
        | low      | envVars                | npm/readable-stream@2.3.8    |
        | low      | filesystemAccess       | npm/browser-resolve@1.11.3   |
        | low      | newAuthor              | npm/wrappy@1.0.2             |
        | low      | noLicenseFound         | npm/indexof@0.0.1            |
        | low      | unidentifiedLicense    | npm/jsonify@0.0.1            |
        | low      | unmaintained           | npm/bowserify@10.2.1         |
        | -------- | ---------------------- | ---------------------------- |
        "
      `)
    })
  })

  describe('go', () => {
    it('should report deep as markdown', () => {
      const txt = createMarkdownReport(goDeep.data, [])
      expect(txt).toMatchInlineSnapshot(`
        "# Complete Package Score

        This is a Socket report for the package *"pkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60"* and its *81* direct/transitive dependencies.

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
        - Maintenance: 100
        - Quality: 100
        - Supply Chain: 70
        - Vulnerability: 84
        - License: 70

        ### Capabilities

        These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.

        - Overall: golang/go.uber.org/mock@v0.5.0
        - Maintenance: golang/github.com/stretchr/objx@v0.1.0
        - Quality: golang/github.com/stretchr/objx@v0.1.0
        - Supply Chain: golang/go.uber.org/mock@v0.5.0
        - Vulnerability: golang/github.com/golang-jwt/jwt/v5@v5.2.1
        - License: golang/github.com/hashicorp/go-cleanhttp@v0.5.2

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

        | -------- | ---------------------- | ------------------------------------------------------------- |
        | Severity | Alert Name             | Example package reporting it                                  |
        | -------- | ---------------------- | ------------------------------------------------------------- |
        | high     | cve                    | golang/github.com/golang-jwt/jwt/v5@v5.2.1                    |
        | middle   | hasNativeCode          | golang/github.com/pkg/diff@v0.0.0-20210226163009-20ebb0f2a09e |
        | middle   | mediumCVE              | golang/golang.org/x/net@v0.35.0                               |
        | middle   | networkAccess          | golang/github.com/stretchr/objx@v0.1.0                        |
        | middle   | potentialVulnerability | golang/github.com/onsi/ginkgo/v2@v2.22.2                      |
        | middle   | shellAccess            | golang/github.com/stretchr/testify@v1.9.0                     |
        | middle   | usesEval               | golang/gopkg.in/yaml.v3@v3.0.1                                |
        | low      | copyleftLicense        | golang/github.com/hashicorp/go-cleanhttp@v0.5.2               |
        | low      | envVars                | golang/gopkg.in/yaml.v3@v3.0.1                                |
        | low      | filesystemAccess       | golang/github.com/stretchr/objx@v0.1.0                        |
        | low      | gptAnomaly             | golang/github.com/stretchr/objx@v0.1.0                        |
        | low      | nonpermissiveLicense   | golang/github.com/hashicorp/go-cleanhttp@v0.5.2               |
        | low      | unidentifiedLicense    | golang/gopkg.in/yaml.v3@v3.0.1                                |
        | -------- | ---------------------- | ------------------------------------------------------------- |
        "
      `)
    })
  })

  describe('ruby', () => {
    it('should report deep as markdown', () => {
      const txt = createMarkdownReport(rubyDeep.data, [])
      expect(txt).toMatchInlineSnapshot(`
        "# Complete Package Score

        This is a Socket report for the package *"pkg:gem/plaid@14.11.0?platform=ruby"* and its *31* direct/transitive dependencies.

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

        - Overall: 72
        - Maintenance: 100
        - Quality: 92
        - Supply Chain: 84
        - Vulnerability: 72
        - License: 70

        ### Capabilities

        These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.

        - Overall: gem/rexml@3.2.4
        - Maintenance: gem/diff-lcs@1.4.4
        - Quality: gem/rspec@3.10.0
        - Supply Chain: gem/rubocop@0.91.1
        - Vulnerability: gem/rexml@3.2.4
        - License: gem/diff-lcs@1.4.4

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

        | -------- | -------------------- | ---------------------------- |
        | Severity | Alert Name           | Example package reporting it |
        | -------- | -------------------- | ---------------------------- |
        | high     | cve                  | gem/rexml@3.2.4              |
        | middle   | mediumCVE            | gem/rexml@3.2.4              |
        | middle   | networkAccess        | gem/faraday@1.8.0            |
        | middle   | shellAccess          | gem/diff-lcs@1.4.4           |
        | middle   | usesEval             | gem/ruby2_keywords@0.0.5     |
        | low      | copyleftLicense      | gem/diff-lcs@1.4.4           |
        | low      | envVars              | gem/parser@2.7.2.0           |
        | low      | filesystemAccess     | gem/diff-lcs@1.4.4           |
        | low      | noLicenseFound       | gem/minitest@5.14.2          |
        | low      | nonpermissiveLicense | gem/diff-lcs@1.4.4           |
        | -------- | -------------------- | ---------------------------- |
        "
      `)
    })
  })

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

        ### Capabilities

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

        ### Capabilities

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

        ### Capabilities

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
