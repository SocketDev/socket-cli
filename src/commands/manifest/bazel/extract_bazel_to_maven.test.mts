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
  extractBazelToMaven,
  normalizeToMavenInstallJson,
} from './extract_bazel_to_maven.mts'

import type { ExtractedArtifact } from './bazel-build-parser.mts'
import type { CqueryRepoResult } from './bazel-cquery.mts'

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

function readManifest(out: string): unknown {
  return JSON.parse(
    readFileSync(
      path.join(out, '.socket-auto-manifest', 'maven_install.json'),
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
    expect(result.ok).toBe(true)
    expect(result.artifactCount).toBe(2)
    const manifest = readManifest(tmp) as {
      artifacts: Record<string, { version: string }>
    }
    expect(Object.keys(manifest.artifacts).sort()).toEqual([
      'androidx.annotation:annotation',
      'com.google.guava:guava',
    ])
  })

  it('returns noEcosystemFound when no workspace roots are discovered', async () => {
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
    expect(result.ok).toBe(false)
    expect(result.noEcosystemFound).toBe(true)
  })

  it('reports detected-but-empty when discovered repos extract zero artifacts', async () => {
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
    expect(result.ok).toBe(false)
    expect(result.noEcosystemFound).toBeUndefined()
  })

  it('dedups artifacts across multiple workspaces by full Maven coordinate', async () => {
    const nested = path.join(tmp, 'examples', 'dagger')
    mkdirSync(nested, { recursive: true })
    vi.mocked(findWorkspaceRoots).mockReturnValue([tmp, nested])
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [
          mkArt('com.google.guava:guava:33.0.0-jre', 'com_google_guava_guava'),
        ],
        repoName: 'maven',
        workspaceRelPath: '',
      }),
    )
    vi.mocked(runMetadataCqueryForRepo).mockResolvedValueOnce(
      mkResult({
        artifacts: [
          // Same coord as the root workspace — must be deduped.
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
    expect(result.artifactCount).toBe(2)
    const manifest = readManifest(tmp) as {
      artifacts: Record<string, { version: string }>
    }
    expect(Object.keys(manifest.artifacts).sort()).toEqual([
      'com.google.dagger:dagger',
      'com.google.guava:guava',
    ])
  })

  it('reports ok:false on per-repo timeout but keeps going', async () => {
    // Two candidates: first times out, second succeeds. The orchestrator
    // re-mints --output_user_root after the timeout.
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
    expect(result.ok).toBe(false)
    expect(result.artifactCount).toBe(1)
  })

  it('threads extraMavenRepoNames into the candidate list (WORKSPACE mode)', async () => {
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: false,
      workspace: true,
    })
    // Probe accepts only `my_jars`; conventional names all return not-defined.
    vi.mocked(buildMavenProbeFor).mockReturnValue(async (name: string) => {
      if (name === 'my_jars') {
        return { code: 0, stdout: '@my_jars//:foo\n', stderr: '' }
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
        repoName: 'my_jars',
      }),
    )
    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      extraMavenRepoNames: ['my_jars'],
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })
    expect(result.ok).toBe(true)
    expect(result.artifactCount).toBe(1)
    expect(runMetadataCqueryForRepo).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runMetadataCqueryForRepo).mock.calls[0]![0]).toMatchObject(
      { repoName: 'my_jars' },
    )
    // show_extension must NOT be called in pure WORKSPACE mode.
    expect(runBazelModShowMavenExtension).not.toHaveBeenCalled()
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
    expect(Object.keys(result.artifacts)).toEqual(['com.google.guava:guava'])
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

  it('builds the dependencies map from resolved coordinate deps', () => {
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
    expect(result.dependencies['com.google.guava:guava']).toEqual([
      'com.google.guava:failureaccess',
    ])
  })

  it('preserves the first artifact’s sha256 when subsequent dupes lack one', () => {
    const result = normalizeToMavenInstallJson([
      {
        deps: [],
        mavenCoordinates: 'com.example:lib:1.0',
        mavenSha256: 'a'.repeat(64),
        ruleKind: 'jvm_import',
        ruleName: 'a',
      },
      {
        deps: [],
        mavenCoordinates: 'com.example:lib:1.0',
        ruleKind: 'jvm_import',
        ruleName: 'a',
      },
    ])
    expect(result.artifacts['com.example:lib']?.shasums.jar).toBe(
      'a'.repeat(64),
    )
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
