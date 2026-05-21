import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the helpers BEFORE importing the orchestrator.
vi.mock('./bazel-workspace-detect.mts', () => ({
  detectWorkspaceMode: vi.fn(),
  getBazelInvocationFlags: vi.fn(() => []),
}))
vi.mock('./bazel-bin-detect.mts', () => ({
  resolveBazelBinary: vi.fn(async () => '/usr/local/bin/bazel'),
}))
vi.mock('./bazel-repo-discovery.mts', () => ({
  discoverMavenRepos: vi.fn(),
  parseVisibleRepoCandidates: vi.fn(() => []),
  parseMavenRepoCandidates: vi.fn(),
  validateMavenRepo: vi.fn(),
}))
const { probe } = vi.hoisted(() => ({
  probe: async () => ({ code: 0, stdout: 'maven_coordinates=' }),
}))
vi.mock('./bazel-query-runner.mts', () => ({
  buildProbeFor: vi.fn(() => probe),
  runBazelModShowVisibleRepos: vi.fn(async () => ({
    code: 0,
    stderr: '',
    stdout: '',
  })),
  runBazelQuery: vi.fn(),
}))
// Mock hardening helpers so unit tests run without real fs/network side-effects.
vi.mock('./bazel-output-base-check.mts', () => ({
  validateOutputBase: vi.fn(),
}))
vi.mock('./bazel-python-shim.mts', () => ({
  provisionPythonShim: vi.fn(async () => ({
    augmentedEnv: undefined,
    shimDir: undefined,
  })),
}))
// ensureJavaOnPath now throws when java is missing; unit tests must not
// depend on the host having a JDK installed.
vi.mock('./bazel-java-shim.mts', () => ({
  ensureJavaOnPath: vi.fn(),
}))

import { validateOutputBase } from './bazel-output-base-check.mts'
import { discoverMavenRepos } from './bazel-repo-discovery.mts'
import { detectWorkspaceMode } from './bazel-workspace-detect.mts'
import {
  extractBazelToMaven,
  normalizeToMavenInstallJson,
} from './extract_bazel_to_maven.mts'

const FIXTURES = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'manifest-bazel',
  'query-output',
)

// Walk a directory recursively and return all file paths.
function walk(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      acc.push(...walk(p))
    } else {
      acc.push(p)
    }
  }
  return acc
}

describe('extractBazelToMaven', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-extract-'))
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    process.exitCode = 0
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.resetAllMocks()
    process.exitCode = 0
  })

  it('dedupes exact duplicate coordinates without failing', () => {
    const manifest = normalizeToMavenInstallJson([
      {
        ruleKind: 'jvm_import',
        ruleName: 'com_example_demo',
        mavenCoordinates: 'com.example:demo:1.0.0',
        deps: [],
      },
      {
        ruleKind: 'jvm_import',
        ruleName: 'com_example_demo',
        mavenCoordinates: 'com.example:demo:1.0.0',
        deps: [],
      },
    ])

    expect(Object.keys(manifest.artifacts)).toEqual(['com.example:demo'])
    expect(manifest.artifacts['com.example:demo']).toEqual({
      shasums: {},
      version: '1.0.0',
    })
  })

  it('fails on duplicate label suffixes when dependency resolution is ambiguous', () => {
    expect(() =>
      normalizeToMavenInstallJson([
        {
          ruleKind: 'jvm_import',
          ruleName: 'root',
          mavenCoordinates: 'com.example:root:1.0.0',
          deps: [':shared_rule_name'],
        },
        {
          ruleKind: 'jvm_import',
          ruleName: 'shared_rule_name',
          mavenCoordinates: 'com.one:lib:1.0.0',
          deps: [],
        },
        {
          ruleKind: 'jvm_import',
          ruleName: 'shared_rule_name',
          mavenCoordinates: 'com.two:lib:1.0.0',
          deps: [],
        },
      ]),
    ).toThrow(/Ambiguous Bazel dependency label :shared_rule_name/)
  })

  it('writes maven_install.json directly under out without a summary sidecar', async () => {
    const sample = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([['maven', sample]]),
    )

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })
    expect(result).toEqual({
      artifactCount: 2,
      manifestPath: path.join(tmp, 'maven_install.json'),
      ok: true,
    })

    const manifestText = readFileSync(
      path.join(tmp, 'maven_install.json'),
      'utf8',
    )
    const manifest = JSON.parse(manifestText)
    expect(manifest.artifacts['com.google.guava:guava']).toEqual({
      shasums: { jar: expect.stringMatching(/^9408c2c4/) },
      version: '33.0.0-jre',
    })
    // Per the canonical rules_jvm_external maven_install.json shape (see
    // normalizeToMavenInstallJson), dependency keys and values use "g:a"
    // (no version) — matching rules_jvm_external lockfile output.
    expect(manifest.dependencies['com.google.guava:guava']).toContain(
      'com.google.guava:failureaccess',
    )

    expect(existsSync(path.join(tmp, 'socket-bazel-summary.json'))).toBe(false)
    expect(existsSync(path.join(tmp, '_whole_repo'))).toBe(false)
  })

  it('writes outputs to .socket-auto-manifest/ when outLayout is "flat"', async () => {
    const sample = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([['maven', sample]]),
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
    expect(result).toEqual({
      artifactCount: 2,
      manifestPath: path.join(
        tmp,
        '.socket-auto-manifest',
        'maven_install.json',
      ),
      ok: true,
    })

    // Manifest lands inside the sibling dir.
    expect(
      existsSync(path.join(tmp, '.socket-auto-manifest', 'maven_install.json')),
    ).toBe(true)
    expect(
      existsSync(
        path.join(tmp, '.socket-auto-manifest', 'socket-bazel-summary.json'),
      ),
    ).toBe(false)
    // Neither output bleeds into <out>/ itself nor a _whole_repo/ wrapper.
    expect(existsSync(path.join(tmp, 'maven_install.json'))).toBe(false)
    expect(existsSync(path.join(tmp, 'socket-bazel-summary.json'))).toBe(false)
    expect(existsSync(path.join(tmp, '_whole_repo'))).toBe(false)
  })

  it('writes NO .socket.facts.json files anywhere under out', async () => {
    const sample = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([['maven', sample]]),
    )

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    const files = walk(tmp)
    expect(
      files.find(f => path.basename(f) === '.socket.facts.json'),
    ).toBeUndefined()
    expect(result.ok).toBe(true)
  })

  it('reports noEcosystemFound without mutating process.exitCode when no repos discovered', async () => {
    vi.mocked(discoverMavenRepos).mockResolvedValue(new Map())

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(process.exitCode).toBe(0)
    expect(result).toEqual({
      artifactCount: 0,
      manifestPath: path.join(tmp, 'maven_install.json'),
      noEcosystemFound: true,
      ok: false,
    })
    // Empty manifest is still written.
    const manifestText = readFileSync(
      path.join(tmp, 'maven_install.json'),
      'utf8',
    )
    const manifest = JSON.parse(manifestText)
    expect(manifest.artifacts).toEqual({})
  })

  it('iterates each discovered repo independently when one has no parseable rules', async () => {
    const sample = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    // First repo's probe stdout has the canonical sample (2 artifacts).
    // Second repo's probe stdout has no parseable jvm_import / aar_import
    // blocks, so the parser yields 0 artifacts for it — the iteration must
    // still surface the first repo's results.
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([
        ['maven', sample],
        ['maven_test', '# no rules here\n'],
      ]),
    )

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    const manifest = JSON.parse(
      readFileSync(path.join(tmp, 'maven_install.json'), 'utf8'),
    )
    // Only the successful repo's artifacts (2); maven_test was skipped.
    expect(Object.keys(manifest.artifacts)).toHaveLength(2)
    expect(result).toEqual({
      artifactCount: 2,
      manifestPath: path.join(tmp, 'maven_install.json'),
      ok: true,
    })
  })

  it('returns failure without mutating process.exitCode when one group:artifact has conflicting versions', async () => {
    const conflictingStdout = [
      'jvm_import(',
      '  name = "com_example_demo_v1",',
      '  maven_coordinates = "com.example:demo:1.0.0",',
      ')',
      'jvm_import(',
      '  name = "com_example_demo_v2",',
      '  maven_coordinates = "com.example:demo:2.0.0",',
      ')',
    ].join('\n')
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([['maven', conflictingStdout]]),
    )

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(process.exitCode).toBe(0)
    expect(result).toEqual({
      artifactCount: 0,
      ok: false,
    })
    expect(existsSync(path.join(tmp, 'maven_install.json'))).toBe(false)
  })

  it('calls validateOutputBase when bazelOutputBase is set', async () => {
    vi.mocked(discoverMavenRepos).mockResolvedValue(new Map())
    await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: tmp,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })
    // validateOutputBase is mocked; verify it was called with the provided path.
    expect(vi.mocked(validateOutputBase)).toHaveBeenCalledWith(tmp, tmp)
  })

  it('propagates verbose into discovery and emits resolved-options / outputs diagnostics', async () => {
    const sample = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([['maven', sample]]),
    )
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const logSpy = vi.spyOn(logger, 'log').mockImplementation(() => logger)

    try {
      await extractBazelToMaven({
        bazelFlags: undefined,
        bazelOutputBase: undefined,
        bazelRc: undefined,
        bin: undefined,
        cwd: tmp,
        out: tmp,
        verbose: true,
      })

      const text = logSpy.mock.calls
        .map(args =>
          args
            .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' '),
        )
        .join('\n')
      // Resolved-options block — names a few known load-bearing fields.
      expect(text).toContain('[VERBOSE] resolved options:')
      expect(text).toContain('bin')
      expect(text).toContain('bazelRc')
      expect(text).toContain('bazelOutputBase')
      // Outputs block names manifest path and extracted summary fields.
      expect(text).toContain('[VERBOSE] outputs:')
      expect(text).toContain('manifest')
      expect(text).toContain('artifactCount')
      expect(text).toContain('generatedManifest')
      expect(text).toContain('mavenRepos')

      // Discovery was called with verbose=true as the 4th positional. The
      // 3rd positional reflects whatever parseVisibleRepoCandidates returned
      // (an empty array in this mocked setup).
      expect(vi.mocked(discoverMavenRepos)).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.any(Array),
        true,
      )
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('SOCKET_BAZEL_FORCE_QUERY_FALLBACK', () => {
  // These tests pit two parsers against each other by giving each a
  // coordinate the other does not produce, then assert which one ran by
  // checking which coordinate landed in the manifest.
  // - unsorted_deps.json (fast path) → `com.example:from-json:9.9.9`
  // - cached probe stdout (regex fallback) → `com.example:from-regex:1.0.0`
  const FAST_PATH_JSON = JSON.stringify({
    artifacts: [
      {
        coordinates: 'com.example:from-json:9.9.9',
        url: 'https://example.invalid/from-json-9.9.9.jar',
        sha256:
          '1111111111111111111111111111111111111111111111111111111111111111',
        deps: [],
      },
    ],
  })

  const FALLBACK_PROBE_STDOUT = [
    'jvm_import(',
    '  name = "com_example_from_regex",',
    '  jars = ["@maven//:from-regex-1.0.0.jar"],',
    '  maven_coordinates = "com.example:from-regex:1.0.0",',
    '  deps = [],',
    ')',
    '',
  ].join('\n')

  let tmp: string
  let originalEnv: string | undefined

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-extract-fallback-'))
    // Place unsorted_deps.json under <bazelOutputBase>/external/maven/.
    // This is what bazelExternalDir resolves to when bazelOutputBase is set.
    const externalRepoDir = path.join(tmp, 'external', 'maven')
    mkdirSync(externalRepoDir, { recursive: true })
    writeFileSync(
      path.join(externalRepoDir, 'unsorted_deps.json'),
      FAST_PATH_JSON,
      'utf8',
    )
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    vi.mocked(discoverMavenRepos).mockResolvedValue(
      new Map([['maven', FALLBACK_PROBE_STDOUT]]),
    )
    originalEnv = process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK']
    process.exitCode = 0
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK']
    } else {
      process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK'] = originalEnv
    }
    rmSync(tmp, { recursive: true, force: true })
    vi.resetAllMocks()
    process.exitCode = 0
  })

  it('uses the unsorted_deps.json fast path when the env var is unset', async () => {
    delete process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK']

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: tmp,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result.ok).toBe(true)
    const manifest = JSON.parse(
      readFileSync(path.join(tmp, 'maven_install.json'), 'utf8'),
    )
    // The JSON parser ran: from-json coord is present, from-regex is absent.
    expect(manifest.artifacts['com.example:from-json']).toBeDefined()
    expect(manifest.artifacts['com.example:from-regex']).toBeUndefined()
  })

  it('skips the unsorted_deps.json fast path and uses the regex fallback when the env var is "1"', async () => {
    process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK'] = '1'

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: tmp,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result.ok).toBe(true)
    const manifest = JSON.parse(
      readFileSync(path.join(tmp, 'maven_install.json'), 'utf8'),
    )
    // The regex parser ran: from-regex coord is present, from-json is absent.
    expect(manifest.artifacts['com.example:from-regex']).toBeDefined()
    expect(manifest.artifacts['com.example:from-json']).toBeUndefined()
  })

  it.each([
    ['unset', undefined],
    ['empty string', ''],
    ['"0"', '0'],
    ['"false"', 'false'],
  ])('treats %s as falsy and uses the fast path', async (_label, value) => {
    if (value === undefined) {
      delete process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK']
    } else {
      process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK'] = value
    }

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: tmp,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result.ok).toBe(true)
    const manifest = JSON.parse(
      readFileSync(path.join(tmp, 'maven_install.json'), 'utf8'),
    )
    expect(manifest.artifacts['com.example:from-json']).toBeDefined()
    expect(manifest.artifacts['com.example:from-regex']).toBeUndefined()
  })

  it.each([
    ['"1"', '1'],
    ['"true"', 'true'],
    ['"YES"', 'YES'],
  ])('treats %s as truthy and forces the fallback', async (_label, value) => {
    process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK'] = value

    const result = await extractBazelToMaven({
      bazelFlags: undefined,
      bazelOutputBase: tmp,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result.ok).toBe(true)
    const manifest = JSON.parse(
      readFileSync(path.join(tmp, 'maven_install.json'), 'utf8'),
    )
    expect(manifest.artifacts['com.example:from-regex']).toBeDefined()
    expect(manifest.artifacts['com.example:from-json']).toBeUndefined()
  })
})
