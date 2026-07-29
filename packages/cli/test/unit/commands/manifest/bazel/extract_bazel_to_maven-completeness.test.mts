/**
 * Unit tests for the Maven extraction orchestrator's completeness signal:
 * indeterminate probes, show_extension classification outcomes, and workspace
 * load failures must never let the run report complete.
 */

import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger so narration is capturable without TTY noise.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock collaborators BEFORE importing the orchestrator; see
// extract_bazel_to_maven.test.mts for the rationale.
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-bin-detect.mts'),
  () => ({
    resolveBazelBinary: vi.fn(async () => '/usr/local/bin/bazel'),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-output-base-check.mts'),
  () => ({
    validateOutputBase: vi.fn(),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-java-shim.mts'),
  () => ({
    ensureJavaOnPath: vi.fn(),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-python-shim.mts'),
  () => ({
    provisionPythonShim: vi.fn(async () => ({
      augmentedEnv: undefined,
      shimDir: undefined,
    })),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-workspace-detect.mts'),
  () => ({
    detectWorkspaceMode: vi.fn(),
    getBazelInvocationFlags: vi.fn(() => []),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-workspace-walk.mts'),
  () => ({
    findWorkspaceRoots: vi.fn(),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-query-runner.mts'),
  () => ({
    buildMavenProbeFor: vi.fn(() => async () => ({
      code: 1,
      stderr: "ERROR: No repository visible as '@x' from main repository\n",
      stdout: '',
    })),
    runBazelModShowMavenExtension: vi.fn(),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-cquery.mts'),
  () => ({
    runMetadataCqueryForRepo: vi.fn(),
  }),
)
// Quiet the spawn calls reapBazelServer makes during cleanup.
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(async () => ({ code: 0, stderr: '', stdout: '' })),
}))

import { runMetadataCqueryForRepo } from '../../../../../src/commands/manifest/bazel/bazel-cquery.mts'
import {
  buildMavenProbeFor,
  runBazelModShowMavenExtension,
} from '../../../../../src/commands/manifest/bazel/bazel-query-runner.mts'
import { detectWorkspaceMode } from '../../../../../src/commands/manifest/bazel/bazel-workspace-detect.mts'
import { findWorkspaceRoots } from '../../../../../src/commands/manifest/bazel/bazel-workspace-walk.mts'
import { extractBazelToMaven } from '../../../../../src/commands/manifest/bazel/extract_bazel_to_maven.mts'
import {
  mkArt,
  mkResult,
  PROBE_NOT_DEFINED,
  SHOW_EXT_HUB_ONLY,
} from './extract-maven-test-helpers.mts'

describe('extractBazelToMaven completeness signal', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-x2m-cmpl-'))
    vi.mocked(detectWorkspaceMode).mockReset()
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    vi.mocked(findWorkspaceRoots).mockReturnValue([tmp])
    vi.mocked(runBazelModShowMavenExtension).mockReset()
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: SHOW_EXT_HUB_ONLY,
    })
    vi.mocked(runMetadataCqueryForRepo).mockReset()
    vi.mocked(buildMavenProbeFor).mockReset()
    vi.mocked(buildMavenProbeFor).mockReturnValue(async () => PROBE_NOT_DEFINED)
    mockLogger.log.mockClear()
  })

  afterEach(async () => {
    await safeDelete(tmp)
  })

  it('flags partial (never complete) when a probe is indeterminate but another hub succeeds', async () => {
    // WORKSPACE mode so the conventional-name probe runs. `maven` succeeds and
    // extracts; `maven_install` probe returns an unrecognized non-zero exit
    // (indeterminate). The run must be partial, never complete, and carry the
    // completeness signal.
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: false,
      workspace: true,
    })
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'maven') {
        return { code: 0, stderr: '', stdout: '@maven//:foo\n' }
      }
      if (name === 'maven_install') {
        // Unrecognized non-zero exit -> indeterminate.
        return { code: 1, stderr: 'bazel internal error\n', stdout: '' }
      }
      return PROBE_NOT_DEFINED
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('partial')
    expect(result.complete).toBe(false)
    expect(result.manifestPaths).toHaveLength(1)
    // The indeterminate hub is recorded in the completeness signal.
    const hubStates = result.workspaceOutcomes.flatMap(w =>
      w.hubs.map(h => h.state),
    )
    expect(hubStates).toContain('indeterminate')
  })

  it('hard-fails (never complete) when the only probe is indeterminate and nothing extracts', async () => {
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: false,
      workspace: true,
    })
    // Every conventional name probe returns an unrecognized non-zero exit.
    vi.mocked(buildMavenProbeFor).mockReturnValue(async () => ({
      code: 1,
      stderr: 'bazel internal error\n',
      stdout: '',
    }))
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    // Nothing analyzable was produced, but a probe was indeterminate, so this
    // is a hard failure, NOT noEcosystem (which would imply "no Maven here").
    expect(result.status).toBe('hardFailure')
    expect(result.complete).toBe(false)
  })

  it('flags partial (never complete) when show_extension fails to evaluate the module graph but a probed hub extracts', async () => {
    // show_extension hit a genuine module-graph EVALUATION failure (not merely
    // "rules_jvm_external isn't a dependency"): authoritative hub enumeration
    // is indeterminate, so custom-named hubs may have been missed. The
    // conventional probe still finds @maven and extracts it, but the run must
    // be partial — never silently complete.
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 1,
      stderr:
        "ERROR: Error evaluating MODULE.bazel: name 'PYTHON_VERSION' is not defined\n",
      stdout: '',
    })
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'maven') {
        return { code: 0, stderr: '', stdout: '@maven//:foo\n' }
      }
      return PROBE_NOT_DEFINED
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('partial')
    expect(result.complete).toBe(false)
    expect(result.manifestPaths).toHaveLength(1)
    // The failed enumeration is recorded as an indeterminate hub outcome.
    const hubStates = result.workspaceOutcomes.flatMap(w =>
      w.hubs.map(h => h.state),
    )
    expect(hubStates).toContain('indeterminate')
  })

  it('stays complete when show_extension runs cleanly and finds no maven extension (legitimate not-defined)', async () => {
    // show_extension ran fine (code 0) but the report has no maven section, so
    // the parse yields zero hubs. This is the legitimate "no maven extension
    // defined" case — NOT an execution failure. The conventional probe then
    // finds @maven and extracts it; the run is complete (no indeterminate
    // enumeration outcome).
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: 'No extensions defined.\n',
    })
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'maven') {
        return { code: 0, stderr: '', stdout: '@maven//:foo\n' }
      }
      return PROBE_NOT_DEFINED
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('complete')
    expect(result.complete).toBe(true)
    const hubStates = result.workspaceOutcomes.flatMap(w =>
      w.hubs.map(h => h.state),
    )
    expect(hubStates).not.toContain('indeterminate')
  })

  it('reports noEcosystem (never hard-fails) when show_extension exits non-zero on a no-Maven bzlmod repo and nothing extracts', async () => {
    // `bazel mod show_extension @rules_jvm_external//:extensions.bzl%maven`
    // exits non-zero on EVERY bzlmod repo that doesn't depend on
    // rules_jvm_external — its argument resolution throws before any Starlark
    // runs. This generic non-zero exit (no eval-failure signature) is the
    // common no-Maven case, NOT a failed enumeration. With no probed hub
    // populating, the run is a clean noEcosystem — it must NOT hard-fail,
    // which would abort the user's entire `scan create --auto-manifest`.
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 1,
      stderr:
        "ERROR: In extension argument '@rules_jvm_external//:extensions.bzl%maven': module 'rules_jvm_external' is not a dependency of the root module\n",
      stdout: '',
    })
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('noEcosystem')
    expect(result.complete).toBe(false)
    // No hub was flagged indeterminate: the non-zero exit was correctly read
    // as "no maven extension here", not a failed enumeration.
    const hubStates = result.workspaceOutcomes.flatMap(w =>
      w.hubs.map(h => h.state),
    )
    expect(hubStates).not.toContain('indeterminate')
  })

  it('hard-fails (never complete) when show_extension fails to evaluate the module graph and nothing extracts', async () => {
    // A genuine module-graph evaluation failure (Starlark eval error / unbound
    // name) leaves hub enumeration indeterminate. With no probed hub
    // populating, nothing analyzable was produced — and because enumeration
    // was indeterminate this is NOT a clean "no Maven here", so it must be a
    // hard failure, never complete and never silently noEcosystem.
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 1,
      stderr:
        "ERROR: Error evaluating MODULE.bazel: name 'pip' is not defined\n",
      stdout: '',
    })
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('hardFailure')
    expect(result.complete).toBe(false)
    const hubStates = result.workspaceOutcomes.flatMap(w =>
      w.hubs.map(h => h.state),
    )
    expect(hubStates).toContain('indeterminate')
  })

  it('never reports complete when one workspace fails to load while another extracts', async () => {
    // Two workspaces: the first loads and extracts cleanly; the second throws
    // on load (e.g. an unreadable MODULE.bazel). A load failure is NOT "no
    // Maven here" — a manifest was written, so the run must be partial, never
    // complete.
    const nested = path.join(tmp, 'broken')
    mkdirSync(nested, { recursive: true })
    vi.mocked(findWorkspaceRoots).mockReturnValue([tmp, nested])
    vi.mocked(detectWorkspaceMode).mockImplementation((root: string) => {
      if (root === nested) {
        throw new Error('unbound variable in MODULE.bazel')
      }
      return { bzlmod: true, workspace: false }
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('partial')
    expect(result.complete).toBe(false)
    expect(result.manifestPaths).toHaveLength(1)
    const loadFailed = result.workspaceOutcomes.filter(w => w.load === 'failed')
    expect(loadFailed).toHaveLength(1)
  })

  it('hard-fails (never complete) when the only workspace fails to load', async () => {
    // A single workspace that cannot be read produces zero manifests. This is
    // a load failure, not noEcosystem — it must be a hard failure, never
    // complete and never silently "no Maven here".
    vi.mocked(detectWorkspaceMode).mockImplementation(() => {
      throw new Error('unbound variable in MODULE.bazel')
    })
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.status).toBe('hardFailure')
    expect(result.complete).toBe(false)
    expect(result.manifestPaths).toEqual([])
  })
})
