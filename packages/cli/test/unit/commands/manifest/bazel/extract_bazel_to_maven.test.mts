/**
 * Unit tests for the Maven extraction orchestrator: core end-to-end outcomes
 * over mocked collaborators and per-(workspace, hub) manifest layout.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// Mock collaborators BEFORE importing the orchestrator. The orchestrator
// composes pure-function discovery + the metadata cquery + a workspace
// walker; mocking these lets us drive end-to-end behaviour without a
// real Bazel toolchain.
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
  readManifest,
  readNamedManifest,
  SHOW_EXT_HUB_ONLY,
} from './extract-maven-test-helpers.mts'

describe('extractBazelToMaven core outcomes', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-x2m-'))
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

  it('extracts a single Bzlmod workspace end-to-end', async () => {
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [
          mkArt('com.google.guava:guava:33.0.0-jre', 'com_google_guava_guava'),
          mkArt('androidx.annotation:annotation:1.8.2', 'androidx_annotation'),
        ],
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
    expect(result.artifactCount).toBe(2)
    expect(result.manifestPaths).toHaveLength(1)
    const manifest = readManifest(tmp) as {
      artifacts: Record<string, { version: string }>
    }
    expect(Object.keys(manifest.artifacts).toSorted()).toEqual([
      'androidx.annotation:annotation',
      'com.google.guava:guava',
    ])
  })

  it('returns status:noEcosystem when no workspace roots are discovered', async () => {
    vi.mocked(findWorkspaceRoots).mockReturnValue([])
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
    expect(result.manifestPaths).toEqual([])
  })

  it('returns status:hardFailure when discovered repos write zero manifests', async () => {
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({ artifacts: [], repoName: 'maven', status: 'empty' }),
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
    expect(result.status).toBe('hardFailure')
    expect(result.manifestPaths).toEqual([])
  })

  it('writes one manifest per workspace at mirrored paths (no cross-workspace aggregation)', async () => {
    const nested = path.join(tmp, 'examples', 'dagger')
    mkdirSync(nested, { recursive: true })
    vi.mocked(findWorkspaceRoots).mockReturnValue([tmp, nested])
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [
          // A previously-conflicting g:a at a different version per workspace
          // now lands in separate files without error.
          mkArt('com.google.guava:guava:32.0.0-jre', 'com_google_guava_guava'),
        ],
        repoName: 'maven',
        workspaceRelPath: '',
      }),
    )
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [
          mkArt('com.google.guava:guava:33.0.0-jre', 'com_google_guava_guava', {
            sourceRepo: 'examples/dagger:maven',
          }),
          mkArt('com.google.dagger:dagger:2.50', 'com_google_dagger_dagger', {
            sourceRepo: 'examples/dagger:maven',
          }),
        ],
        repoName: 'maven',
        workspaceRelPath: 'examples/dagger',
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
    expect(result.manifestPaths).toHaveLength(2)
    // Root workspace: one file at the manifest dir root.
    const rootManifest = readManifest(tmp) as {
      artifacts: Record<string, { version: string }>
    }
    expect(rootManifest.artifacts['com.google.guava:guava']?.version).toBe(
      '32.0.0-jre',
    )
    // Nested workspace: mirrored path.
    const nestedManifest = readManifest(tmp, 'examples', 'dagger') as {
      artifacts: Record<string, { version: string }>
    }
    expect(Object.keys(nestedManifest.artifacts).toSorted()).toEqual([
      'com.google.dagger:dagger',
      'com.google.guava:guava',
    ])
    expect(nestedManifest.artifacts['com.google.guava:guava']?.version).toBe(
      '33.0.0-jre',
    )
  })

  it('writes one manifest per hub in a single workspace', async () => {
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
  - maven_dev (imported by <root>)
`,
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:b:1.0', 'b')],
        repoName: 'maven_dev',
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
    expect(result.manifestPaths).toHaveLength(2)
    expect(
      Object.keys(
        (readManifest(tmp) as { artifacts: Record<string, unknown> }).artifacts,
      ),
    ).toEqual(['com.example:a'])
    expect(
      Object.keys(
        (
          readNamedManifest(tmp, 'maven_dev_maven_install.json') as {
            artifacts: Record<string, unknown>
          }
        ).artifacts,
      ),
    ).toEqual(['com.example:b'])
  })

  it('returns status:partial on a per-repo timeout but keeps the survivor', async () => {
    // Two candidates: first times out, second succeeds. The orchestrator
    // re-mints --output_user_root after the timeout and still writes the
    // survivor's manifest.
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
  - maven_dev (imported by <root>)
`,
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({ artifacts: [], repoName: 'maven', status: 'timeout' }),
    )
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:after:1.0', 'after')],
        repoName: 'maven_dev',
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
      perRepoTimeoutMs: 60_000,
      verbose: false,
    })
    expect(result.status).toBe('partial')
    expect(result.artifactCount).toBe(1)
    expect(result.manifestPaths).toHaveLength(1)
    expect(
      Object.keys(
        (
          readNamedManifest(tmp, 'maven_dev_maven_install.json') as {
            artifacts: Record<string, unknown>
          }
        ).artifacts,
      ),
    ).toEqual(['com.example:after'])
  })

  it('returns status:partial when a hub reports unresolved dependency edges', async () => {
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
        status: 'partial',
        unresolvedLabels: ['@maven//:missing'],
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
    expect(result.manifestPaths).toHaveLength(1)
  })

  it('returns status:partial when cquery itself reported partial (no unresolved labels)', async () => {
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
        status: 'partial',
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
    expect(result.manifestPaths).toHaveLength(1)
  })

  it('does not abort the walk when a hub manifest write fails', async () => {
    // Point `out` at a regular file so the manifest dir cannot be created;
    // the write throws and must be swallowed into a hub failure, not abort.
    const blocker = path.join(tmp, 'blocker')
    writeFileSync(blocker, '')
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
      out: blocker,
      outLayout: 'flat',
      verbose: false,
    })
    // The only hub failed to write, so zero manifests + ecosystem present.
    expect(result.status).toBe('hardFailure')
    expect(result.manifestPaths).toEqual([])
  })

  it('applies the default walker prune policy even when the caller passes none', async () => {
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    const calls = vi.mocked(findWorkspaceRoots).mock.calls
    const call = calls[calls.length - 1]![0]
    const names = [...(call.ignoreDirNames ?? [])]
    expect(names).toContain('node_modules')
    expect(names).toContain('.git')
    expect(names).toContain('.socket-auto-manifest')
    expect(call.ignoreDirPrefixes).toContain('bazel-')
  })

  it('extends (not replaces) the default prune policy with caller-supplied dirs', async () => {
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:a:1.0', 'a')],
        repoName: 'maven',
      }),
    )
    await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      ignoreDirNames: new Set(['custom_dir']),
      ignoreDirPrefixes: ['gen-'],
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    const calls = vi.mocked(findWorkspaceRoots).mock.calls
    const call = calls[calls.length - 1]![0]
    const names = [...(call.ignoreDirNames ?? [])]
    expect(names).toEqual(
      expect.arrayContaining(['node_modules', 'custom_dir']),
    )
    expect(call.ignoreDirPrefixes).toEqual(
      expect.arrayContaining(['bazel-', 'gen-']),
    )
  })
})
