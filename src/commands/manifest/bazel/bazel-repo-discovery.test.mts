import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  CONVENTIONAL_MAVEN_REPO_NAMES,
  classifyProbeResult,
  classifyShowExtensionResult,
  parseShowExtensionOutput,
  probeCandidate,
} from './bazel-repo-discovery.mts'

import type {
  ProbeResult,
  ProbeStatus,
  RepoProbe,
  ShowExtensionStatus,
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

const probePopulatedGuava: RepoProbe = async () => ({
  code: 0,
  stdout: '@maven//:guava\n',
  stderr: '',
})

const probePopulatedX: RepoProbe = async () => ({
  code: 0,
  stdout: '@maven//:x\n',
  stderr: '',
})

const probeThrows: RepoProbe = async () => {
  throw new Error('bazel exploded')
}

describe('bazel-repo-discovery', () => {
  describe('parseShowExtensionOutput', () => {
    it('extracts hub repos with (imported by ...) annotations and their importers', () => {
      // The 6 hub repos in the fixture are the ones with annotations;
      // generated per-artifact repos (no annotation) are skipped.
      expect(parseShowExtensionOutput(TINK_SHOW_EXTENSION_FIXTURE)).toEqual([
        {
          importers: ['rules_android@0.6.6'],
          name: 'android_ide_common_30_1_3',
        },
        {
          importers: ['<root>', 'bazel_worker_java@0.0.4', 'protobuf@32.1'],
          name: 'maven',
        },
        { importers: ['rules_android@0.6.6'], name: 'rules_android_maven' },
        {
          importers: ['rules_jvm_external@6.7'],
          name: 'rules_jvm_external_deps',
        },
        { importers: ['stardoc@0.7.2'], name: 'stardoc_maven' },
        {
          importers: ['rules_jvm_external@6.7'],
          name: 'unpinned_rules_jvm_external_deps',
        },
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
      expect(parseShowExtensionOutput(input)).toEqual([
        { importers: ['<root>'], name: 'maven' },
        { importers: ['foo'], name: 'other' },
      ])
    })

    it('tolerates canonical-name separator variants (~ and +)', () => {
      for (const sep of ['+', '~']) {
        const input = `## @@rules_jvm_external${sep}//:extensions.bzl%maven:\n\nFetched repositories:\n  - maven (imported by <root>)\n`
        expect(parseShowExtensionOutput(input)).toEqual([
          { importers: ['<root>'], name: 'maven' },
        ])
      }
    })

    it('merges importers when the same hub appears twice with different importers', () => {
      const input =
        '## @@rules_jvm_external+//:extensions.bzl%maven:\n\nFetched repositories:\n  - maven (imported by <root>)\n  - maven (imported by foo)\n'
      expect(parseShowExtensionOutput(input)).toEqual([
        { importers: ['<root>', 'foo'], name: 'maven' },
      ])
    })

    it('records a non-root-only importer (orchestrator drops it, importer retained for diagnostics)', () => {
      const input =
        '## @@rules_jvm_external+//:extensions.bzl%maven:\n\nFetched repositories:\n  - stardoc_maven (imported by stardoc@0.7.2)\n'
      expect(parseShowExtensionOutput(input)).toEqual([
        { importers: ['stardoc@0.7.2'], name: 'stardoc_maven' },
      ])
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
              'WARNING: Evaluation of query "@maven_install//..." failed: no targets found beneath \'\'\n',
          }),
        ),
      ).toBe<ProbeStatus>('empty')
    })

    it('classifies code=0 + empty stdout (WORKSPACE-mode silent miss) as not-defined', () => {
      expect(
        classifyProbeResult(probeResult({ code: 0, stdout: '' })),
      ).toBe<ProbeStatus>('not-defined')
    })

    it('classifies code=1 + unrecognized stderr as indeterminate (not a silent skip)', () => {
      // An unrecognized non-zero exit is NOT proof the repo is absent; it must
      // surface as indeterminate so the orchestrator never reports complete on
      // a workspace it could not actually analyze.
      expect(
        classifyProbeResult(
          probeResult({ code: 1, stderr: 'some other failure\n' }),
        ),
      ).toBe<ProbeStatus>('indeterminate')
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

    it('classifies a non-zero exit with no recognizable message as indeterminate', () => {
      expect(
        classifyProbeResult(probeResult({ code: 37, stderr: '' })),
      ).toBe<ProbeStatus>('indeterminate')
    })
  })

  describe('classifyShowExtensionResult', () => {
    // NOTE: the exact bazel stderr wording for these error families should be
    // confirmed against a live `bazel mod show_extension` run; the sandbox
    // blocks bazel here, so the strings below are representative shapes.
    it('classifies code=0 with parsed root hubs as defined', () => {
      expect(
        classifyShowExtensionResult(probeResult({ code: 0 }), 2),
      ).toBe<ShowExtensionStatus>('defined')
    })

    it('classifies a clean code=0 run with zero kept hubs as not-defined', () => {
      // Ran fine, no maven extension for the root: legitimate absence.
      expect(
        classifyShowExtensionResult(
          probeResult({ code: 0, stdout: 'No extensions defined.\n' }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('not-defined')
    })

    it('classifies "module is not a dependency of the root module" (rules_jvm_external not in dep graph) as not-defined', () => {
      // The COMMON no-Maven bzlmod repo: ModCommand resolves the extension
      // argument up front and throws InvalidArgumentException before any
      // Starlark runs. Non-zero exit, but authoritatively "no maven here".
      expect(
        classifyShowExtensionResult(
          probeResult({
            code: 1,
            stderr:
              "ERROR: In extension argument '@rules_jvm_external//:extensions.bzl%maven': module 'rules_jvm_external' is not a dependency of the root module\n",
          }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('not-defined')
    })

    it('classifies the real Bazel "no module ... exists in the dependency graph" arg error (exit 2) as not-defined', () => {
      // Verbatim stderr from `bazel mod show_extension` on a bzlmod repo
      // without rules_jvm_external (verified on real Bazel against angular and
      // buildbuddy: exit code 2). This is the dominant no-Maven case and must
      // never be escalated to indeterminate / hardFailure.
      expect(
        classifyShowExtensionResult(
          probeResult({
            code: 2,
            stderr:
              "ERROR: In extension argument @rules_jvm_external//:extensions.bzl%maven: No module with the apparent repo name @rules_jvm_external exists in the dependency graph. Type 'bazel help mod' for syntax and help.\n",
          }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('not-defined')
    })

    it('classifies the real Bazel unbound-name MODULE.bazel failure (exit 2) as indeterminate', () => {
      // Verbatim stderr from `bazel mod show_extension --enable_bzlmod` on the
      // envoy mobile/ fragment (verified on real Bazel: exit 2). A genuine
      // eval failure: we cannot conclude maven is absent, so it is
      // indeterminate even though the unbound-name text also trips the
      // not-in-graph "not defined" branch (eval-failure is checked first).
      expect(
        classifyShowExtensionResult(
          probeResult({
            code: 2,
            stderr:
              "ERROR: /work/mobile/MODULE.bazel:26:1: name 'pip' is not defined (did you mean 'zip'?)\nERROR: syntax error in MODULE.bazel file for <root>.\n",
          }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('indeterminate')
    })

    it('classifies a generic "extension not found / not resolvable" arg error as not-defined', () => {
      expect(
        classifyShowExtensionResult(
          probeResult({
            code: 1,
            stderr:
              'ERROR: extension argument: no such module @rules_jvm_external\n',
          }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('not-defined')
    })

    it('classifies a genuine MODULE.bazel evaluation failure (unbound name) as indeterminate', () => {
      expect(
        classifyShowExtensionResult(
          probeResult({
            code: 1,
            stderr:
              "ERROR: Error evaluating MODULE.bazel: name 'PYTHON_VERSION' is not defined\n",
          }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('indeterminate')
    })

    it('classifies a Starlark syntax error in the module graph as indeterminate', () => {
      expect(
        classifyShowExtensionResult(
          probeResult({
            code: 1,
            stderr: 'ERROR: /work/MODULE.bazel:3:1: syntax error near pip\n',
          }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('indeterminate')
    })

    it('classifies a spawn failure / missing binary (normalized code -1) as indeterminate', () => {
      expect(
        classifyShowExtensionResult(probeResult({ code: -1 }), 0),
      ).toBe<ShowExtensionStatus>('indeterminate')
    })

    it('biases a truly unrecognized non-zero exit toward not-defined (extension-not-in-graph dominates; never abort the scan)', () => {
      // We only escalate to indeterminate when stderr positively looks like an
      // eval/load failure. An unrecognized arg-style error must not flip a
      // no-Maven repo into a hard failure that aborts the whole scan.
      expect(
        classifyShowExtensionResult(
          probeResult({ code: 7, stderr: 'ERROR: something unexpected\n' }),
          0,
        ),
      ).toBe<ShowExtensionStatus>('not-defined')
    })
  })

  describe('probeCandidate', () => {
    it('returns the classified status from a probe', async () => {
      expect(
        await probeCandidate('maven', probePopulatedGuava),
      ).toBe<ProbeStatus>('populated')
    })

    it('returns indeterminate when the probe throws (infra failure, not absence)', async () => {
      expect(await probeCandidate('crash', probeThrows)).toBe<ProbeStatus>(
        'indeterminate',
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
      await probeCandidate('maven', probePopulatedX)
      expect(logSpy).not.toHaveBeenCalled()
    })

    it('probeCandidate logs the status under verbose', async () => {
      await probeCandidate('maven', probePopulatedX, true)
      expect(loggedLines()).toMatch(/probe @maven:\s*populated/)
    })

    it('probeCandidate logs the throw reason under verbose', async () => {
      await probeCandidate('crash', probeThrows, true)
      expect(loggedLines()).toMatch(
        /probe @crash:\s*indeterminate \(probe threw: bazel exploded\)/,
      )
    })
  })
})
