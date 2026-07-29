/**
 * Unit tests for the Maven extraction orchestrator's committed-lockfile gate,
 * the emitted completeness summary file, and the flat output layout.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
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
  readManifest,
  SHOW_EXT_HUB_ONLY,
} from './extract-maven-test-helpers.mts'

describe('extractBazelToMaven committed-lockfile gate + outputs', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-x2m-gate-'))
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

  it('skips emitting a hub manifest when a committed lockfile already covers it', async () => {
    // A committed maven_install.json under the workspace means the server-side
    // walker already ingests it; the CLI must NOT re-emit a synthetic copy.
    writeFileSync(
      path.join(tmp, 'maven_install.json'),
      JSON.stringify({ artifacts: {}, dependencies: {} }),
      'utf8',
    )
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
    // The hub was skipped, so no synthetic manifest and the cquery never runs.
    expect(result.manifestPaths).toHaveLength(0)
    expect(runMetadataCqueryForRepo).not.toHaveBeenCalled()
    const skipped = result.workspaceOutcomes.flatMap(w =>
      w.hubs.filter(h => h.state === 'skipped-lockfile').map(h => h.hub),
    )
    expect(skipped).toContain('maven')
  })

  it('extracts the root hub even when a nested dir holds a maven_install.json (no any-depth match)', async () => {
    // The root @maven is UNCOVERED: there is no maven_install.json directly in
    // the workspace root. A nested fixture/example holds its own
    // maven_install.json, which covers ITS workspace, not the root hub. An
    // any-depth gate would wrongly judge the root hub covered, skip its
    // synthetic emit, and silently drop its distinct coordinates. The gate is
    // depth-0, so the root hub must still be extracted.
    const nested = path.join(tmp, 'examples', 'nested')
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      path.join(nested, 'maven_install.json'),
      JSON.stringify({ artifacts: {}, dependencies: {} }),
      'utf8',
    )
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [mkArt('com.example:rootonly:1.0', 'rootonly')],
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
    // The root hub was NOT skipped: cquery ran and the synthetic manifest
    // carrying the root's distinct coordinate was emitted.
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
    expect(result.manifestPaths).toHaveLength(1)
    const manifest = readManifest(tmp) as {
      artifacts: Record<string, { version: string }>
    }
    expect(Object.keys(manifest.artifacts)).toEqual(['com.example:rootonly'])
    const skipped = result.workspaceOutcomes.flatMap(w =>
      w.hubs.filter(h => h.state === 'skipped-lockfile').map(h => h.hub),
    )
    expect(skipped).toEqual([])
  })

  it('reports complete:true with zero synthetic manifests when every hub is covered by a committed root-level lockfile', async () => {
    // A committed maven_install.json sits directly in the workspace root, so
    // the only discovered hub is covered. The CLI writes zero synthetic
    // manifests and the run must headline complete:true.
    writeFileSync(
      path.join(tmp, 'maven_install.json'),
      JSON.stringify({ artifacts: {}, dependencies: {} }),
      'utf8',
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
    expect(result.manifestPaths).toHaveLength(0)
    expect(runMetadataCqueryForRepo).not.toHaveBeenCalled()
    // The emitted completeness summary also headlines complete:true.
    const summary = JSON.parse(
      readFileSync(
        path.join(
          tmp,
          '.socket-auto-manifest',
          'socket-bazel-manifest-summary.json',
        ),
        'utf8',
      ),
    ) as { complete: boolean; status: string }
    expect(summary.complete).toBe(true)
    expect(summary.status).toBe('complete')
  })

  it('does not treat a prior-run synthetic manifest in the output dir as a committed lockfile', async () => {
    // A previous run left a synthetic maven_install.json inside the output dir
    // (.socket-auto-manifest). A later run must NOT read it as a committed
    // lockfile and skip the hub; it must re-extract.
    const outputDir = path.join(tmp, '.socket-auto-manifest')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(
      path.join(outputDir, 'maven_install.json'),
      JSON.stringify({ artifacts: {}, dependencies: {} }),
      'utf8',
    )
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
    // The stale synthetic file did not gate the hub: cquery ran and a manifest
    // was emitted.
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
    expect(result.manifestPaths).toHaveLength(1)
    const skipped = result.workspaceOutcomes.flatMap(w =>
      w.hubs.filter(h => h.state === 'skipped-lockfile').map(h => h.hub),
    )
    expect(skipped).toEqual([])
  })

  it('maps a non-default hub to <hub>_maven_install.json for the committed-lockfile gate', async () => {
    // A non-default hub `maven_dev` is covered only by a committed file named
    // `maven_dev_maven_install.json`. A bare `maven_install.json` must NOT
    // cover it, and the prefixed file must.
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven_dev (imported by <root>)
`,
    })
    writeFileSync(
      path.join(tmp, 'maven_dev_maven_install.json'),
      JSON.stringify({ artifacts: {}, dependencies: {} }),
      'utf8',
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
    expect(runMetadataCqueryForRepo).not.toHaveBeenCalled()
    const skipped = result.workspaceOutcomes.flatMap(w =>
      w.hubs.filter(h => h.state === 'skipped-lockfile').map(h => h.hub),
    )
    expect(skipped).toContain('maven_dev')
  })

  it('still emits a synthetic manifest when no committed lockfile covers the hub', async () => {
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
    expect(result.manifestPaths).toHaveLength(1)
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
  })

  it('writes a completeness summary carrying the machine-readable signal', async () => {
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
    const summary = JSON.parse(
      readFileSync(
        path.join(
          tmp,
          '.socket-auto-manifest',
          'socket-bazel-manifest-summary.json',
        ),
        'utf8',
      ),
    ) as { complete: boolean; status: string; workspaces: unknown[] }
    expect(summary.complete).toBe(false)
    expect(summary.status).toBe('partial')
    expect(Array.isArray(summary.workspaces)).toBe(true)
  })

  it('writes maven_install.json into .socket-auto-manifest in flat layout and never emits a facts file', async () => {
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
    expect(
      existsSync(path.join(tmp, '.socket-auto-manifest', 'maven_install.json')),
    ).toBe(true)
    // The Maven path is BOM-only: no reachability facts file is emitted.
    expect(
      existsSync(path.join(tmp, '.socket-auto-manifest', '.socket.facts.json')),
    ).toBe(false)
  })
})
