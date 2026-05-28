import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  CONVENTIONAL_MAVEN_REPO_NAMES,
  classifyProbeResult,
  parseShowExtensionOutput,
  probeCandidate,
} from './bazel-repo-discovery.mts'

import type {
  ProbeResult,
  ProbeStatus,
  RepoProbe,
} from './bazel-repo-discovery.mts'

// Truncated text-format report Bazel 8.4.2 emits on tink-java for
// `bazel mod show_extension @rules_jvm_external//:extensions.bzl%maven`.
// The headline shape: a `## @@<canonical>//:extensions.bzl%maven:` header,
// blank line, then `Fetched repositories:` and a bullet list. Hub repos
// carry `(imported by ...)`; generated artifact repos don't.
const TINK_SHOW_EXTENSION_FIXTURE = `DEBUG: irrelevant noise
WARNING: also irrelevant

## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - android_ide_common_30_1_3 (imported by rules_android@0.6.6)
  - maven (imported by <root>, bazel_worker_java@0.0.4, protobuf@32.1)
  - rules_android_maven (imported by rules_android@0.6.6)
  - rules_jvm_external_deps (imported by rules_jvm_external@6.7)
  - stardoc_maven (imported by stardoc@0.7.2)
  - unpinned_rules_jvm_external_deps (imported by rules_jvm_external@6.7)
  - aopalliance_aopalliance_1_0
  - aopalliance_aopalliance_jar_sources_1_0
  - androidx_annotation_annotation
`

const probeResult = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  code: 0,
  stdout: '',
  stderr: '',
  ...over,
})

describe('bazel-repo-discovery', () => {
  describe('parseShowExtensionOutput', () => {
    it('extracts hub repos with (imported by ...) annotations only', () => {
      // The 6 hub repos in the fixture are the ones with annotations;
      // generated per-artifact repos (no annotation) are skipped.
      expect(parseShowExtensionOutput(TINK_SHOW_EXTENSION_FIXTURE)).toEqual([
        'android_ide_common_30_1_3',
        'maven',
        'rules_android_maven',
        'rules_jvm_external_deps',
        'stardoc_maven',
        'unpinned_rules_jvm_external_deps',
      ])
    })

    it('returns [] when the maven section is missing', () => {
      expect(
        parseShowExtensionOutput(
          'DEBUG: noise\n\n## @@other//:extensions.bzl%other:\n\nFetched repositories:\n  - foo (imported by <root>)\n',
        ),
      ).toEqual([])
    })

    it('returns [] when Fetched repositories: is absent', () => {
      expect(
        parseShowExtensionOutput(
          '## @@rules_jvm_external+//:extensions.bzl%maven:\n\nOther stuff\n',
        ),
      ).toEqual([])
    })

    it('stops at the next section header (multiple extensions in one report)', () => {
      const input =
        '## @@rules_jvm_external+//:extensions.bzl%maven:\n\nFetched repositories:\n  - maven (imported by <root>)\n  - other (imported by foo)\n\n## @@rules_python+//:extensions.bzl%pip:\n\nFetched repositories:\n  - pypi (imported by <root>)\n'
      expect(parseShowExtensionOutput(input)).toEqual(['maven', 'other'])
    })

    it('tolerates canonical-name separator variants (~ and +)', () => {
      for (const sep of ['+', '~']) {
        const input = `## @@rules_jvm_external${sep}//:extensions.bzl%maven:\n\nFetched repositories:\n  - maven (imported by <root>)\n`
        expect(parseShowExtensionOutput(input)).toEqual(['maven'])
      }
    })

    it('deduplicates if the same hub appears twice (defensive)', () => {
      const input =
        '## @@rules_jvm_external+//:extensions.bzl%maven:\n\nFetched repositories:\n  - maven (imported by <root>)\n  - maven (imported by foo)\n'
      expect(parseShowExtensionOutput(input)).toEqual(['maven'])
    })
  })

  describe('classifyProbeResult', () => {
    it('classifies code=0 + non-empty stdout as populated', () => {
      expect(
        classifyProbeResult(
          probeResult({ code: 0, stdout: '@maven//:guava\n' }),
        ),
      ).toBe<ProbeStatus>('populated')
    })

    it('classifies code=1 + "No repository visible" stderr as not-defined', () => {
      expect(
        classifyProbeResult(
          probeResult({
            code: 1,
            stderr:
              "ERROR: No repository visible as '@nonexistent_repo_xyz' from main repository\n",
          }),
        ),
      ).toBe<ProbeStatus>('not-defined')
    })

    it('classifies code=1 + "no targets found beneath" stderr as empty', () => {
      expect(
        classifyProbeResult(
          probeResult({
            code: 1,
            stderr:
              "WARNING: Evaluation of query \"@maven_install//...\" failed: no targets found beneath ''\n",
          }),
        ),
      ).toBe<ProbeStatus>('empty')
    })

    it('classifies code=0 + empty stdout (WORKSPACE-mode silent miss) as not-defined', () => {
      expect(
        classifyProbeResult(probeResult({ code: 0, stdout: '' })),
      ).toBe<ProbeStatus>('not-defined')
    })

    it('classifies code=1 + unrecognized stderr conservatively as not-defined', () => {
      expect(
        classifyProbeResult(
          probeResult({ code: 1, stderr: 'some other failure\n' }),
        ),
      ).toBe<ProbeStatus>('not-defined')
    })

    it('classifies code=1 + "no such package" stderr as not-defined', () => {
      expect(
        classifyProbeResult(
          probeResult({
            code: 1,
            stderr: "ERROR: no such package '@unknown_repo//'\n",
          }),
        ),
      ).toBe<ProbeStatus>('not-defined')
    })
  })

  describe('probeCandidate', () => {
    it('returns the classified status from a probe', async () => {
      const probe: RepoProbe = async () => ({
        code: 0,
        stdout: '@maven//:guava\n',
        stderr: '',
      })
      expect(await probeCandidate('maven', probe)).toBe<ProbeStatus>('populated')
    })

    it('returns not-defined when the probe throws', async () => {
      const probe: RepoProbe = async () => {
        throw new Error('bazel exploded')
      }
      expect(await probeCandidate('crash', probe)).toBe<ProbeStatus>(
        'not-defined',
      )
    })
  })

  describe('CONVENTIONAL_MAVEN_REPO_NAMES', () => {
    it('includes the documented set', () => {
      expect(CONVENTIONAL_MAVEN_REPO_NAMES).toEqual([
        'maven',
        'maven_install',
        'maven_dev',
        'unpinned_maven',
        'maven_unpinned',
      ])
    })
  })

  describe('verbose diagnostics', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(logger, 'log').mockImplementation(() => logger)
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    function loggedLines(): string {
      return logSpy.mock.calls
        .map(args => args.map(a => String(a)).join(' '))
        .join('\n')
    }

    it('probeCandidate stays silent without verbose', async () => {
      const probe: RepoProbe = async () => ({
        code: 0,
        stdout: '@maven//:x\n',
        stderr: '',
      })
      await probeCandidate('maven', probe)
      expect(logSpy).not.toHaveBeenCalled()
    })

    it('probeCandidate logs the status under verbose', async () => {
      const probe: RepoProbe = async () => ({
        code: 0,
        stdout: '@maven//:x\n',
        stderr: '',
      })
      await probeCandidate('maven', probe, true)
      expect(loggedLines()).toMatch(/probe @maven:\s*populated/)
    })

    it('probeCandidate logs the throw reason under verbose', async () => {
      const probe: RepoProbe = async () => {
        throw new Error('bazel exploded')
      }
      await probeCandidate('crash', probe, true)
      expect(loggedLines()).toMatch(
        /probe @crash:\s*not-defined \(probe threw: bazel exploded\)/,
      )
    })
  })
})
