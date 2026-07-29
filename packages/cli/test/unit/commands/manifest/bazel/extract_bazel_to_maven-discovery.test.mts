/**
 * Unit tests for the Maven extraction orchestrator's hub discovery: the
 * root-importer filter, the conventional-probe fallback, WORKSPACE-mode
 * probing, and verbose narration.
 */

import { mkdtempSync } from 'node:fs'
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

describe('extractBazelToMaven hub discovery', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-x2m-disc-'))
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

  it('keeps only root-imported hubs, dropping transitive ruleset hubs', async () => {
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
  - rules_jvm_external_deps (imported by rules_jvm_external@6.7)
  - stardoc_maven (imported by stardoc@0.7.2)
`,
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
    // Only @maven is queried; the ruleset hubs are filtered out.
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runMetadataCqueryForRepo).mock.calls[0]![0]).toMatchObject(
      { repoName: 'maven' },
    )
  })

  it('falls back to conventional probing when show_extension lists only non-root hubs', async () => {
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - stardoc_maven (imported by stardoc@0.7.2)
`,
    })
    // All entries are non-root, so the filter yields zero kept hubs and the
    // probe fallback must still run. The probe accepts conventional @maven.
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'maven') {
        return { code: 0, stderr: '', stdout: '@maven//:x\n' }
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
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runMetadataCqueryForRepo).mock.calls[0]![0]).toMatchObject(
      { repoName: 'maven' },
    )
  })

  it('probes conventional hub names in WORKSPACE mode', async () => {
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: false,
      workspace: true,
    })
    // Probe accepts the conventional `maven` hub; others return not-defined.
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'maven') {
        return { code: 0, stderr: '', stdout: '@maven//:foo\n' }
      }
      return PROBE_NOT_DEFINED
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:custom:1.0', 'custom')],
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
    expect(result.artifactCount).toBe(1)
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runMetadataCqueryForRepo).mock.calls[0]![0]).toMatchObject(
      { repoName: 'maven' },
    )
    // show_extension must NOT be called in pure WORKSPACE mode.
    expect(runBazelModShowMavenExtension).not.toHaveBeenCalled()
  })

  it('narrates the per-hub cquery under verbose without changing the outcome', async () => {
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
      verbose: true,
    })
    expect(result.status).toBe('complete')
    const logged = mockLogger.log.mock.calls.map(c => String(c[0])).join('\n')
    expect(logged).toMatch(/running metadata cquery for @maven/)
    expect(logged).toMatch(/status=ok.*->.*maven_install\.json/)
  })
})
