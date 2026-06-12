import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

// Mock collaborators BEFORE importing the orchestrator. The orchestrator
// composes pure-function discovery + the metadata cquery + a workspace
// walker; mocking these lets us drive end-to-end behaviour without a
// real Bazel toolchain.
vi.mock('./bazel-bin-detect.mts', () => ({
  resolveBazelBinary: vi.fn(async () => '/usr/local/bin/bazel'),
}))
vi.mock('./bazel-output-base-check.mts', () => ({
  validateOutputBase: vi.fn(),
}))
vi.mock('./bazel-java-shim.mts', () => ({
  ensureJavaOnPath: vi.fn(),
}))
vi.mock('./bazel-python-shim.mts', () => ({
  provisionPythonShim: vi.fn(async () => ({
    augmentedEnv: undefined,
    shimDir: undefined,
  })),
}))
vi.mock('./bazel-workspace-detect.mts', () => ({
  detectWorkspaceMode: vi.fn(),
  getBazelInvocationFlags: vi.fn(() => []),
}))
vi.mock('./bazel-workspace-walk.mts', () => ({
  findWorkspaceRoots: vi.fn(),
}))
vi.mock('./bazel-query-runner.mts', () => ({
  buildMavenProbeFor: vi.fn(() => defaultMavenProbe),
  runBazelModShowMavenExtension: vi.fn(),
}))
vi.mock('./bazel-repo-discovery.mts', async () => {
  // Preserve `CONVENTIONAL_MAVEN_REPO_NAMES` + `probeCandidate` while
  // overriding `parseShowExtensionOutput` with a spy.
  const actual = await vi.importActual<
    typeof import('./bazel-repo-discovery.mts')
  >('./bazel-repo-discovery.mts')
  return {
    ...actual,
    parseShowExtensionOutput: vi.fn(actual.parseShowExtensionOutput),
  }
})
vi.mock('./bazel-cquery.mts', () => ({
  runMetadataCqueryForRepo: vi.fn(),
}))
// Quiet the spawn calls reapBazelServer makes during cleanup.
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
}))

import { runMetadataCqueryForRepo } from './bazel-cquery.mts'
import {
  buildMavenProbeFor,
  runBazelModShowMavenExtension,
} from './bazel-query-runner.mts'
import { parseShowExtensionOutput } from './bazel-repo-discovery.mts'
import { detectWorkspaceMode } from './bazel-workspace-detect.mts'
import { findWorkspaceRoots } from './bazel-workspace-walk.mts'
import {
  dedupArtifactsByCoord,
  extractBazelToMaven,
  normalizeToMavenInstallJson,
} from './extract_bazel_to_maven.mts'

import type { CqueryRepoResult, ExtractedArtifact } from './bazel-cquery.mts'

async function defaultMavenProbe(_: string): Promise<{
  code: number
  stdout: string
  stderr: string
}> {
  return {
    code: 1,
    stdout: '',
    stderr: "ERROR: No repository visible as '@x' from main repository\n",
  }
}

function readManifest(out: string, ...rel: string[]): unknown {
  return JSON.parse(
    readFileSync(
      path.join(out, '.socket-auto-manifest', ...rel, 'maven_install.json'),
      'utf8',
    ),
  )
}

function readNamedManifest(
  out: string,
  fileName: string,
  ...rel: string[]
): unknown {
  return JSON.parse(
    readFileSync(
      path.join(out, '.socket-auto-manifest', ...rel, fileName),
      'utf8',
    ),
  )
}

const mkResult = (over: Partial<CqueryRepoResult>): CqueryRepoResult => ({
  artifacts: [],
  durationMs: 0,
  repoName: 'maven',
  status: 'ok',
  stderr: '',
  unresolvedLabels: [],
  workspaceRelPath: '',
  ...over,
})

const mkArt = (
  coord: string,
  ruleName: string,
  over: Partial<ExtractedArtifact> = {},
): ExtractedArtifact => ({
  deps: [],
  mavenCoordinates: coord,
  ruleKind: 'jvm_import',
  ruleName,
  sourceRepo: 'maven',
  ...over,
})

const SHOW_EXT_HUB_ONLY = `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
`

describe('extractBazelToMaven', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-x2m-'))
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    vi.mocked(findWorkspaceRoots).mockReturnValue([tmp])
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stdout: SHOW_EXT_HUB_ONLY,
      stderr: '',
    })
    vi.mocked(parseShowExtensionOutput).mockClear()
    vi.mocked(runBazelModShowMavenExtension).mockClear()
    vi.mocked(runMetadataCqueryForRepo).mockReset()
    vi.mocked(buildMavenProbeFor).mockReset()
    vi.mocked(buildMavenProbeFor).mockReturnValue(async () => ({
      code: 1,
      stdout: '',
      stderr: "ERROR: No repository visible as '@x' from main repository\n",
    }))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
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
    expect(Object.keys(manifest.artifacts).sort()).toEqual([
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
      mkResult({ artifacts: [], status: 'empty', repoName: 'maven' }),
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
    expect(Object.keys(nestedManifest.artifacts).sort()).toEqual([
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
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
  - maven_dev (imported by <root>)
`,
      stderr: '',
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

  it('unions resolved edges across deduped occurrences of a coordinate', () => {
    // The dedup keeps one artifact per full coordinate but must union the
    // resolved edges of every occurrence; otherwise edges resolved against a
    // second workspace's targets would be silently dropped. Verified directly
    // on the dedup+normalize path so the edge targets need to be listed.
    const manifest = normalizeToMavenInstallJson(
      dedupArtifactsByCoord([
        mkArt('com.google.guava:guava:33.0.0-jre', 'guava', {
          deps: ['com.google.dagger:dagger'],
        }),
        mkArt('com.google.guava:guava:33.0.0-jre', 'guava', {
          deps: ['com.x:x'],
        }),
        mkArt('com.google.dagger:dagger:2.50', 'dagger'),
        mkArt('com.x:x:1.0', 'x'),
      ]),
    )
    expect(
      manifest.json.dependencies['com.google.guava:guava']?.sort(),
    ).toEqual(['com.google.dagger:dagger', 'com.x:x'])
    expect(manifest.prunedEdges).toEqual([])
  })

  it('returns status:partial on a per-repo timeout but keeps the survivor', async () => {
    // Two candidates: first times out, second succeeds. The orchestrator
    // re-mints --output_user_root after the timeout and still writes the
    // survivor's manifest.
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
  - maven_dev (imported by <root>)
`,
      stderr: '',
    })
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({ artifacts: [], status: 'timeout', repoName: 'maven' }),
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

  it('applies the default walker prune policy even when the caller passes none (A)', async () => {
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
    const call = vi.mocked(findWorkspaceRoots).mock.calls.at(-1)![0]
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
    const call = vi.mocked(findWorkspaceRoots).mock.calls.at(-1)![0]
    const names = [...(call.ignoreDirNames ?? [])]
    expect(names).toEqual(
      expect.arrayContaining(['node_modules', 'custom_dir']),
    )
    expect(call.ignoreDirPrefixes).toEqual(
      expect.arrayContaining(['bazel-', 'gen-']),
    )
  })

  it('keeps only root-imported hubs, dropping transitive ruleset hubs (B)', async () => {
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
  - rules_jvm_external_deps (imported by rules_jvm_external@6.7)
  - stardoc_maven (imported by stardoc@0.7.2)
`,
      stderr: '',
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

  it('falls back to conventional probing when show_extension lists only non-root hubs (E)', async () => {
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stdout: `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - stardoc_maven (imported by stardoc@0.7.2)
`,
      stderr: '',
    })
    // All entries are non-root, so the filter yields zero kept hubs and the
    // probe fallback must still run. The probe accepts conventional @maven.
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'maven') {
        return { code: 0, stdout: '@maven//:x\n', stderr: '' }
      }
      return {
        code: 1,
        stdout: '',
        stderr: "ERROR: No repository visible as '@x' from main repository\n",
      }
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
        return { code: 0, stdout: '@maven//:foo\n', stderr: '' }
      }
      return {
        code: 1,
        stdout: '',
        stderr: "ERROR: No repository visible as '@x' from main repository\n",
      }
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
    const logSpy = vi.spyOn(logger, 'log').mockImplementation(() => logger)
    try {
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
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toMatch(/running metadata cquery for @maven/)
      expect(logged).toMatch(/status=ok.*->.*maven_install\.json/)
    } finally {
      logSpy.mockRestore()
    }
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
        return { code: 0, stdout: '@maven//:foo\n', stderr: '' }
      }
      if (name === 'maven_install') {
        // Unrecognized non-zero exit -> indeterminate.
        return { code: 1, stdout: '', stderr: 'bazel internal error\n' }
      }
      return {
        code: 1,
        stdout: '',
        stderr: "ERROR: No repository visible as '@x' from main repository\n",
      }
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
      stdout: '',
      stderr: 'bazel internal error\n',
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

  it('writes maven_install.json into .socket-auto-manifest in flat layout', async () => {
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
  })
})

describe('normalizeToMavenInstallJson', () => {
  it('dedupes exact duplicate coordinates without failing', () => {
    const result = normalizeToMavenInstallJson([
      {
        deps: [],
        mavenCoordinates: 'com.google.guava:guava:33.0.0-jre',
        ruleKind: 'jvm_import',
        ruleName: 'com_google_guava_guava',
      },
      {
        deps: [],
        mavenCoordinates: 'com.google.guava:guava:33.0.0-jre',
        ruleKind: 'jvm_import',
        ruleName: 'com_google_guava_guava',
      },
    ])
    expect(Object.keys(result.json.artifacts)).toEqual([
      'com.google.guava:guava',
    ])
  })

  it('fails on conflicting versions for the same group:artifact', () => {
    expect(() =>
      normalizeToMavenInstallJson([
        {
          deps: [],
          mavenCoordinates: 'com.example:lib:1.0',
          ruleKind: 'jvm_import',
          ruleName: 'a',
        },
        {
          deps: [],
          mavenCoordinates: 'com.example:lib:2.0',
          ruleKind: 'jvm_import',
          ruleName: 'b',
        },
      ]),
    ).toThrow(/Conflicting versions/)
  })

  it('emits no shasums key on artifacts', () => {
    const result = normalizeToMavenInstallJson([
      {
        deps: [],
        mavenCoordinates: 'com.example:lib:1.0',
        ruleKind: 'jvm_import',
        ruleName: 'a',
      },
    ])
    expect(result.json.artifacts['com.example:lib']).toEqual({ version: '1.0' })
    expect(result.json.artifacts['com.example:lib']).not.toHaveProperty(
      'shasums',
    )
  })

  it('emits a closed graph: all edges between emitted artifacts survive', () => {
    const result = normalizeToMavenInstallJson([
      {
        deps: ['com.google.guava:failureaccess'],
        mavenCoordinates: 'com.google.guava:guava:33.0.0-jre',
        ruleKind: 'jvm_import',
        ruleName: 'com_google_guava_guava',
      },
      {
        deps: [],
        mavenCoordinates: 'com.google.guava:failureaccess:1.0.2',
        ruleKind: 'jvm_import',
        ruleName: 'com_google_guava_failureaccess',
      },
    ])
    expect(result.json.dependencies['com.google.guava:guava']).toEqual([
      'com.google.guava:failureaccess',
    ])
    expect(result.droppedArtifacts).toEqual([])
    expect(result.prunedEdges).toEqual([])
  })

  it('keeps the :aar packaging segment on the artifact key', () => {
    const result = normalizeToMavenInstallJson([
      {
        deps: [],
        mavenCoordinates: 'androidx.test:monitor:aar:1.7.2',
        ruleKind: 'aar_import',
        ruleName: 'androidx_test_monitor',
      },
    ])
    expect(Object.keys(result.json.artifacts)).toEqual([
      'androidx.test:monitor:aar',
    ])
  })

  it('skips a malformed coordinate (empty version) and reports it as dropped', () => {
    const result = normalizeToMavenInstallJson([
      {
        deps: [],
        // `g:a:` strips to the valid-shaped key `g:a` but an empty version.
        mavenCoordinates: 'com.example:lib:',
        ruleKind: 'jvm_import',
        ruleName: 'a',
      },
    ])
    expect(Object.keys(result.json.artifacts)).toEqual([])
    expect(result.droppedArtifacts).toEqual(['com.example:lib:'])
  })

  it('prunes a dangling edge whose target was never emitted and reports it', () => {
    const result = normalizeToMavenInstallJson([
      {
        // Target `g:a:` is malformed and dropped, so the inbound edge dangles.
        deps: ['com.example:lib'],
        mavenCoordinates: 'com.example:consumer:1.0',
        ruleKind: 'jvm_import',
        ruleName: 'consumer',
      },
      {
        deps: [],
        mavenCoordinates: 'com.example:lib:',
        ruleKind: 'jvm_import',
        ruleName: 'lib',
      },
    ])
    expect(result.json.dependencies['com.example:consumer']).toBeUndefined()
    expect(result.prunedEdges).toEqual([
      'com.example:consumer -> com.example:lib',
    ])
    expect(result.droppedArtifacts).toEqual(['com.example:lib:'])
  })
})

describe('fixture-driven write-output', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-write-'))
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    vi.mocked(findWorkspaceRoots).mockReturnValue([tmp])
    vi.mocked(runBazelModShowMavenExtension).mockResolvedValue({
      code: 0,
      stdout: SHOW_EXT_HUB_ONLY,
      stderr: '',
    })
    vi.mocked(runMetadataCqueryForRepo).mockReset()
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValue(
      mkResult({
        artifacts: [mkArt('com.example:lib:1.0', 'lib')],
        repoName: 'maven',
      }),
    )
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('does not emit any .socket.facts.json file (Maven path is BOM-only)', async () => {
    const outDir = path.join(tmp, 'out')
    mkdirSync(outDir, { recursive: true })
    // Sanity: ensure unrelated files in out/ are not touched.
    writeFileSync(path.join(outDir, 'README.md'), '')
    await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: outDir,
      outLayout: 'flat',
      verbose: false,
    })
    expect(
      existsSync(
        path.join(outDir, '.socket-auto-manifest', '.socket.facts.json'),
      ),
    ).toBe(false)
    expect(
      existsSync(
        path.join(outDir, '.socket-auto-manifest', 'maven_install.json'),
      ),
    ).toBe(true)
  })
})
