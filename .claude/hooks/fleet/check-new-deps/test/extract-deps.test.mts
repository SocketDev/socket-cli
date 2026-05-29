import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// node:child_process.spawnSync is used here directly (not lib's
// spawnSync wrapper) because the wrapper's types don't expose the
// `input` field — we need to pipe the hook payload through stdin.
// The wrapper isn't adding any security here: nodeBin comes from
// whichSync (validated path) and the only arg is hookScript (a
// path we control). Same shape Node's native API has.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, mkdtempSync, promises as fsp, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'

import {
  buildAuditRecords,
  depFromPurl,
  depIdentity,
  deriveSessionId,
  levenshtein,
  suggestSimilarName,
} from '../audit.mts'
import {
  cache,
  cacheGet,
  cacheSet,
  diffDeps,
  extractBrewfile,
  extractNewDeps,
  extractNixFlake,
  extractNpmLockfile,
  extractTerraform,
} from '../index.mts'

const hookScript = new URL('../index.mts', import.meta.url).pathname
const nodeBinRaw = whichSync('node')
if (!nodeBinRaw) {
  throw new Error('"node" not found on PATH')
}
// whichSync can return string | string[]; the first hit is canonical.
const nodeBin: string = Array.isArray(nodeBinRaw) ? nodeBinRaw[0]! : nodeBinRaw

interface RunHookOptions {
  // Override HOME/USERPROFILE so the audit log + 404 cache don't
  // leak into the developer's real ~/.claude.
  home?: string | undefined
  transcript_path?: string | undefined
  session_id?: string | undefined
}

// Helper: run the full hook as a subprocess.
// Uses spawnSync because we need to pipe stdin content (the hook reads JSON from stdin).
function runHook(
  toolInput: Record<string, unknown>,
  toolName = 'Edit',
  options: RunHookOptions = {},
): { code: number | null; stdout: string; stderr: string } {
  const payload: Record<string, unknown> = {
    tool_name: toolName,
    tool_input: toolInput,
  }
  if (options.transcript_path) {
    payload['transcript_path'] = options.transcript_path
  }
  if (options.session_id) {
    payload['session_id'] = options.session_id
  }
  const input = JSON.stringify(payload)
  // Inherit the parent env (so PATH / NODE / etc. work) and only
  // override HOME/USERPROFILE when the test wants an isolated $HOME.
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (options.home) {
    env['HOME'] = options.home
    env['USERPROFILE'] = options.home
  }
  const result = spawnSync(nodeBin, [hookScript], {
    input,
    timeout: 15_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    stdioString: true,
    env,
  })
  return {
    code: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

// Allocate a throwaway $HOME for each test that touches persistent
// state. Cleaned up via a finally block so failing tests don't pile
// up junk in $TMPDIR.
function makeTempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'check-new-deps-test-'))
}

function removeTempHome(home: string): void {
  if (existsSync(home)) {
    rmSync(home, { recursive: true, force: true })
  }
}

// ============================================================================
// Unit tests: extractNewDeps per ecosystem
// ============================================================================

describe('extractNewDeps', () => {
  // npm
  describe('npm', () => {
    it('unscoped', () => {
      const d = extractNewDeps('package.json', '"lodash": "^4.17.21"')
      assert.equal(d.length, 1)
      assert.equal(d[0]!.type, 'npm')
      assert.equal(d[0]!.name, 'lodash')
      assert.equal(d[0]!.namespace, undefined)
    })
    it('scoped', () => {
      const d = extractNewDeps('package.json', '"@types/node": "^20.0.0"')
      assert.equal(d[0]!.namespace, '@types')
      assert.equal(d[0]!.name, 'node')
    })
    it('multiple', () => {
      const d = extractNewDeps(
        'package.json',
        '"a": "1", "@b/c": "2", "d": "3"',
      )
      assert.equal(d.length, 3)
    })
    it('ignores node: builtins', () => {
      assert.equal(extractNewDeps('package.json', '"node:fs": "1"').length, 0)
    })
    it('ignores relative', () => {
      assert.equal(extractNewDeps('package.json', '"./foo": "1"').length, 0)
    })
    it('ignores absolute', () => {
      assert.equal(extractNewDeps('package.json', '"/foo": "1"').length, 0)
    })
    it('ignores capitalized keys', () => {
      assert.equal(
        extractNewDeps('package.json', '"Name": "my-project"').length,
        0,
      )
    })
    it('handles workspace protocol', () => {
      const d = extractNewDeps('package.json', '"my-lib": "workspace:*"')
      assert.equal(d.length, 1)
    })
  })

  // cargo
  describe('cargo', () => {
    it('inline version', () => {
      const d = extractNewDeps('Cargo.toml', 'serde = "1.0"')
      assert.deepEqual(d[0], { type: 'cargo', name: 'serde' })
    })
    it('table version', () => {
      const d = extractNewDeps(
        'Cargo.toml',
        'serde = { version = "1.0", features = ["derive"] }',
      )
      assert.equal(d[0]!.name, 'serde')
    })
    it('hyphenated name', () => {
      assert.equal(
        extractNewDeps('Cargo.toml', 'simd-json = "0.17"')[0]!.name,
        'simd-json',
      )
    })
    it('multiple', () => {
      assert.equal(
        extractNewDeps('Cargo.toml', 'a = "1"\nb = { version = "2" }').length,
        2,
      )
    })
  })

  // golang
  describe('golang', () => {
    it('with namespace', () => {
      const d = extractNewDeps('go.mod', 'github.com/gin-gonic/gin v1.9.1')
      assert.equal(d[0]!.namespace, 'github.com/gin-gonic')
      assert.equal(d[0]!.name, 'gin')
    })
    it('stdlib extension', () => {
      const d = extractNewDeps('go.mod', 'golang.org/x/sync v0.7.0')
      assert.equal(d[0]!.namespace, 'golang.org/x')
      assert.equal(d[0]!.name, 'sync')
    })
  })

  // pypi
  describe('pypi', () => {
    it('requirements.txt', () => {
      const d = extractNewDeps('requirements.txt', 'flask>=2.0\nrequests==2.31')
      assert.ok(d.some(x => x.name === 'flask'))
      assert.ok(d.some(x => x.name === 'requests'))
    })
    it('pyproject.toml', () => {
      assert.ok(
        extractNewDeps('pyproject.toml', '"django>=4.2"').some(
          x => x.name === 'django',
        ),
      )
    })
    it('setup.py', () => {
      assert.ok(
        extractNewDeps('setup.py', '"numpy>=1.24"').some(
          x => x.name === 'numpy',
        ),
      )
    })
  })

  // gem
  describe('gem', () => {
    it('single-quoted', () => {
      assert.equal(extractNewDeps('Gemfile', "gem 'rails'")[0]!.name, 'rails')
    })
    it('double-quoted with version', () => {
      assert.equal(
        extractNewDeps('Gemfile', 'gem "sinatra", "~> 3.0"')[0]!.name,
        'sinatra',
      )
    })
  })

  // maven
  describe('maven', () => {
    it('pom.xml', () => {
      const d = extractNewDeps(
        'pom.xml',
        '<groupId>org.apache</groupId><artifactId>commons-lang3</artifactId>',
      )
      assert.equal(d[0]!.namespace, 'org.apache')
      assert.equal(d[0]!.name, 'commons-lang3')
    })
    it('build.gradle', () => {
      const d = extractNewDeps(
        'build.gradle',
        "implementation 'com.google.guava:guava:32.1'",
      )
      assert.equal(d[0]!.namespace, 'com.google.guava')
      assert.equal(d[0]!.name, 'guava')
    })
    it('build.gradle.kts', () => {
      const d = extractNewDeps(
        'build.gradle.kts',
        "implementation 'org.jetbrains:annotations:24.0'",
      )
      assert.equal(d[0]!.name, 'annotations')
    })
  })

  // swift
  describe('swift', () => {
    it('github package', () => {
      const d = extractNewDeps(
        'Package.swift',
        '.package(url: "https://github.com/vapor/vapor", from: "4.0.0")',
      )
      assert.equal(d[0]!.type, 'swift')
      assert.equal(d[0]!.name, 'vapor')
    })
  })

  // pub
  describe('pub', () => {
    it('dart package', () => {
      assert.equal(
        extractNewDeps('pubspec.yaml', '  flutter_bloc: ^8.1')[0]!.name,
        'flutter_bloc',
      )
    })
  })

  // hex
  describe('hex', () => {
    it('elixir dep', () => {
      assert.equal(
        extractNewDeps('mix.exs', '{:phoenix, "~> 1.7"}')[0]!.name,
        'phoenix',
      )
    })
  })

  // composer
  describe('composer', () => {
    it('vendor/package', () => {
      const d = extractNewDeps('composer.json', '"monolog/monolog": "^3.0"')
      assert.equal(d[0]!.namespace, 'monolog')
      assert.equal(d[0]!.name, 'monolog')
    })
  })

  // nuget
  describe('nuget', () => {
    it('.csproj PackageReference', () => {
      assert.equal(
        extractNewDeps(
          'test.csproj',
          '<PackageReference Include="Newtonsoft.Json" Version="13.0" />',
        )[0]!.name,
        'Newtonsoft.Json',
      )
    })
  })

  // julia
  describe('julia', () => {
    it('Project.toml', () => {
      assert.equal(
        extractNewDeps('Project.toml', 'JSON3 = "0a1fb500"')[0]!.name,
        'JSON3',
      )
    })
  })

  // conan
  describe('conan', () => {
    it('conanfile.txt', () => {
      assert.equal(
        extractNewDeps('conanfile.txt', 'boost/1.83.0')[0]!.name,
        'boost',
      )
    })
    it('conanfile.py', () => {
      assert.equal(
        extractNewDeps('conanfile.py', 'requires = "zlib/1.3.0"')[0]!.name,
        'zlib',
      )
    })
  })

  // github actions
  describe('github actions', () => {
    it('extracts action with version', () => {
      const d = extractNewDeps(
        '.github/workflows/ci.yml',
        'uses: actions/checkout@v4',
      )
      assert.equal(d[0]!.type, 'github')
      assert.equal(d[0]!.namespace, 'actions')
      assert.equal(d[0]!.name, 'checkout')
    })
    it('extracts action with SHA', () => {
      const d = extractNewDeps(
        '.github/workflows/ci.yml',
        'uses: actions/setup-node@abc123def',
      )
      assert.equal(d[0]!.name, 'setup-node')
    })
    it('extracts action with subpath', () => {
      const d = extractNewDeps(
        '.github/workflows/ci.yml',
        'uses: org/repo/subpath@v1',
      )
      assert.equal(d[0]!.namespace, 'org')
      assert.equal(d[0]!.name, 'repo/subpath')
    })
    it('multiple actions', () => {
      const d = extractNewDeps(
        '.github/workflows/ci.yml',
        'uses: a/b@v1\n    uses: c/d@v2',
      )
      assert.equal(d.length, 2)
    })
  })

  // terraform
  describe('terraform', () => {
    it('registry module source', () => {
      const d = extractTerraform('source = "hashicorp/consul/aws"')
      assert.equal(d[0]!.type, 'terraform')
      assert.equal(d[0]!.namespace, 'hashicorp')
      assert.equal(d[0]!.name, 'consul')
    })
    it('via extractNewDeps', () => {
      const d = extractNewDeps(
        'main.tf',
        'source = "cloudflare/dns/cloudflare"',
      )
      assert.equal(d.length, 1)
      assert.equal(d[0]!.namespace, 'cloudflare')
    })
  })

  // nix flakes
  describe('nix flakes', () => {
    it('github input', () => {
      const d = extractNixFlake('inputs.nixpkgs.url = "github:NixOS/nixpkgs"')
      assert.equal(d[0]!.type, 'github')
      assert.equal(d[0]!.namespace, 'NixOS')
      assert.equal(d[0]!.name, 'nixpkgs')
    })
    it('via extractNewDeps', () => {
      const d = extractNewDeps(
        'flake.nix',
        'url = "github:nix-community/home-manager"',
      )
      assert.equal(d.length, 1)
      assert.equal(d[0]!.name, 'home-manager')
    })
  })

  // homebrew
  describe('homebrew', () => {
    it('brew formula', () => {
      const d = extractBrewfile('brew "git"')
      assert.equal(d[0]!.type, 'brew')
      assert.equal(d[0]!.name, 'git')
    })
    it('cask', () => {
      const d = extractBrewfile('cask "firefox"')
      assert.equal(d[0]!.name, 'firefox')
    })
    it('via extractNewDeps', () => {
      const d = extractNewDeps('Brewfile', 'brew "wget"\ncask "iterm2"')
      assert.equal(d.length, 2)
    })
  })

  // lockfiles
  describe('lockfiles', () => {
    it('package-lock.json', () => {
      const d = extractNpmLockfile(
        '"node_modules/lodash": { "version": "4.17.21" }',
      )
      assert.ok(d.some(x => x.name === 'lodash'))
    })
    it('pnpm-lock.yaml', () => {
      const d = extractNewDeps(
        'pnpm-lock.yaml',
        "'/lodash@4.17.21':\n  resolution:",
      )
      assert.ok(d.some(x => x.name === 'lodash'))
    })
    it('yarn.lock', () => {
      const d = extractNewDeps('yarn.lock', '"lodash@^4.17.21":\n  version:')
      assert.ok(d.some(x => x.name === 'lodash'))
    })
    it('Cargo.lock', () => {
      const d = extractNewDeps(
        'Cargo.lock',
        'name = "serde"\nversion = "1.0.210"',
      )
      assert.equal(d[0]!.type, 'cargo')
      assert.equal(d[0]!.name, 'serde')
    })
    it('go.sum', () => {
      const d = extractNewDeps(
        'go.sum',
        'github.com/gin-gonic/gin v1.9.1 h1:abc=',
      )
      assert.equal(d[0]!.type, 'golang')
      assert.equal(d[0]!.name, 'gin')
    })
    it('Gemfile.lock', () => {
      const d = extractNewDeps(
        'Gemfile.lock',
        '    rails (7.1.0)\n    activerecord (7.1.0)',
      )
      assert.ok(d.some(x => x.name === 'rails'))
    })
    it('composer.lock', () => {
      const d = extractNewDeps('composer.lock', '"name": "monolog/monolog"')
      assert.equal(d[0]!.namespace, 'monolog')
      assert.equal(d[0]!.name, 'monolog')
    })
    it('poetry.lock', () => {
      const d = extractNewDeps(
        'poetry.lock',
        'name = "flask"\nversion = "3.0.0"',
      )
      assert.ok(d.some(x => x.name === 'flask'))
    })
    it('pubspec.lock', () => {
      const d = extractNewDeps(
        'pubspec.lock',
        '  flutter_bloc:\n    dependency: direct',
      )
      assert.ok(d.some(x => x.name === 'flutter_bloc'))
    })
  })

  // windows paths
  describe('windows paths', () => {
    it('handles backslash in package.json path', () => {
      const d = extractNewDeps(
        'C:\\Users\\foo\\project\\package.json',
        '"lodash": "^4"',
      )
      assert.equal(d.length, 1)
      assert.equal(d[0]!.name, 'lodash')
    })
    it('handles backslash in workflow path', () => {
      const d = extractNewDeps(
        '.github\\workflows\\ci.yml',
        'uses: actions/checkout@v4',
      )
      assert.equal(d.length, 1)
      assert.equal(d[0]!.name, 'checkout')
    })
    it('handles backslash in Cargo.toml path', () => {
      const d = extractNewDeps('src\\parser\\Cargo.toml', 'serde = "1.0"')
      assert.equal(d.length, 1)
    })
  })

  // pass-through
  describe('unsupported files', () => {
    it('returns empty for .rs', () => {
      assert.equal(extractNewDeps('main.rs', 'fn main(){}').length, 0)
    })
    it('returns empty for .js', () => {
      assert.equal(extractNewDeps('index.js', 'x').length, 0)
    })
    it('returns empty for .md', () => {
      assert.equal(extractNewDeps('README.md', '# hi').length, 0)
    })
  })
})

// ============================================================================
// Unit tests: diffDeps
// ============================================================================

describe('diffDeps', () => {
  it('returns only new deps', () => {
    const newDeps = [
      { type: 'npm', name: 'a' },
      { type: 'npm', name: 'b' },
    ]
    const oldDeps = [{ type: 'npm', name: 'a' }]
    const result = diffDeps(newDeps, oldDeps)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.name, 'b')
  })
  it('returns empty when no new deps', () => {
    const deps = [{ type: 'npm', name: 'a' }]
    assert.equal(diffDeps(deps, deps).length, 0)
  })
  it('returns all when old is empty', () => {
    const deps = [
      { type: 'npm', name: 'a' },
      { type: 'npm', name: 'b' },
    ]
    assert.equal(diffDeps(deps, []).length, 2)
  })
})

// ============================================================================
// Unit tests: cache
// ============================================================================

describe('cache', () => {
  it('stores and retrieves entries', () => {
    cache.clear()
    cacheSet('pkg:npm/test', { purl: 'pkg:npm/test', blocked: true })
    const entry = cacheGet('pkg:npm/test')
    assert.ok(entry)
    assert.equal(entry!.result?.blocked, true)
  })
  it('returns undefined for missing keys', () => {
    cache.clear()
    assert.equal(cacheGet('pkg:npm/missing'), undefined)
  })
  it('evicts expired entries on get', () => {
    cache.clear()
    // Manually insert an expired entry.
    cache.set('pkg:npm/expired', {
      result: undefined,
      expiresAt: Date.now() - 1000,
    })
    assert.equal(cacheGet('pkg:npm/expired'), undefined)
    assert.equal(cache.has('pkg:npm/expired'), false)
  })
  it('caches undefined for clean deps', () => {
    cache.clear()
    cacheSet('pkg:npm/clean', undefined)
    const entry = cacheGet('pkg:npm/clean')
    assert.ok(entry)
    assert.equal(entry!.result, undefined)
  })
})

// ============================================================================
// Integration tests: full hook subprocess
// ============================================================================

describe('hook integration', () => {
  // Blocking
  it('blocks malware (npm)', async () => {
    const r = await runHook({
      file_path: '/tmp/package.json',
      new_string: '"bradleymeck": "^1.0.0"',
    })
    assert.equal(r.code, 2)
    assert.ok(r.stderr.includes('blocked'))
  })

  // Allowing
  it('allows clean npm package', async () => {
    const r = await runHook({
      file_path: '/tmp/package.json',
      new_string: '"lodash": "^4.17.21"',
    })
    assert.equal(r.code, 0)
  })
  it('allows scoped npm package', async () => {
    const r = await runHook({
      file_path: '/tmp/package.json',
      new_string: '"@types/node": "^20"',
    })
    assert.equal(r.code, 0)
  })
  it('allows cargo crate', async () => {
    const r = await runHook({
      file_path: '/tmp/Cargo.toml',
      new_string: 'serde = "1.0"',
    })
    assert.equal(r.code, 0)
  })
  it('allows go module', async () => {
    const r = await runHook({
      file_path: '/tmp/go.mod',
      new_string: 'golang.org/x/sync v0.7.0',
    })
    assert.equal(r.code, 0)
  })
  it('allows pypi package', async () => {
    const r = await runHook({
      file_path: '/tmp/requirements.txt',
      new_string: 'flask>=2.0',
    })
    assert.equal(r.code, 0)
  })
  it('allows ruby gem', async () => {
    const r = await runHook({
      file_path: '/tmp/Gemfile',
      new_string: "gem 'rails'",
    })
    assert.equal(r.code, 0)
  })
  it('allows maven dep', async () => {
    const r = await runHook({
      file_path: '/tmp/build.gradle',
      new_string: "implementation 'com.google.guava:guava:32.1'",
    })
    assert.equal(r.code, 0)
  })
  it('allows nuget package', async () => {
    const r = await runHook({
      file_path: '/tmp/test.csproj',
      new_string:
        '<PackageReference Include="Newtonsoft.Json" Version="13.0" />',
    })
    assert.equal(r.code, 0)
  })
  it('allows github action', async () => {
    const r = await runHook({
      file_path: '/tmp/.github/workflows/ci.yml',
      new_string: 'uses: actions/checkout@v4',
    })
    assert.equal(r.code, 0)
  })

  // Pass-through
  it('passes non-dep files', async () => {
    const r = await runHook({
      file_path: '/tmp/main.rs',
      new_string: 'fn main(){}',
    })
    assert.equal(r.code, 0)
  })
  it('passes non-Edit tools', async () => {
    const r = await runHook({ file_path: '/tmp/package.json' }, 'Read')
    assert.equal(r.code, 0)
  })

  // Diff-aware
  it('skips pre-existing deps in old_string', async () => {
    const r = await runHook({
      file_path: '/tmp/package.json',
      old_string: '"lodash": "^4.17.21"',
      new_string: '"lodash": "^4.17.21"',
    })
    assert.equal(r.code, 0)
  })
  it('checks only NEW deps when old_string present', async () => {
    const r = await runHook({
      file_path: '/tmp/package.json',
      old_string: '"lodash": "^4.17.21"',
      new_string: '"lodash": "^4.17.21", "bradleymeck": "^1.0.0"',
    })
    assert.equal(r.code, 2)
  })

  // Batch (multiple deps in one request)
  it('checks multiple deps in batch (fast)', async () => {
    const start = Date.now()
    const r = await runHook({
      file_path: '/tmp/package.json',
      new_string: '"express": "^4", "lodash": "^4", "debug": "^4"',
    })
    assert.equal(r.code, 0)
    assert.ok(Date.now() - start < 5000, 'batch should be fast')
  })

  // Write tool
  it('works with Write tool', async () => {
    const r = await runHook(
      { file_path: '/tmp/package.json', content: '"lodash": "^4"' },
      'Write',
    )
    assert.equal(r.code, 0)
  })

  // Empty content
  it('handles empty content', async () => {
    const r = await runHook({
      file_path: '/tmp/package.json',
      new_string: '',
    })
    assert.equal(r.code, 0)
  })

  // Lockfile monitoring
  it('checks lockfile deps (Cargo.lock)', async () => {
    const r = await runHook({
      file_path: '/tmp/Cargo.lock',
      new_string: 'name = "serde"\nversion = "1.0.210"',
    })
    assert.equal(r.code, 0)
  })

  // Terraform
  it('checks terraform module', async () => {
    const r = await runHook({
      file_path: '/tmp/main.tf',
      new_string: 'source = "hashicorp/consul/aws"',
    })
    assert.equal(r.code, 0)
  })
})

// ============================================================================
// Unit tests: PURL <-> identity helpers
// ============================================================================

describe('depIdentity / depFromPurl', () => {
  it('round-trips an unscoped npm dep', () => {
    const id = depIdentity({ type: 'npm', name: 'lodash' })
    assert.equal(id, 'npm/lodash')
  })
  it('round-trips a scoped npm dep', () => {
    const id = depIdentity({
      type: 'npm',
      name: 'node',
      namespace: '@types',
    })
    assert.equal(id, 'npm/@types/node')
  })
  it('parses unscoped purl', () => {
    const d = depFromPurl('pkg:npm/lodash@4.17.21')
    assert.equal(d?.type, 'npm')
    assert.equal(d?.name, 'lodash')
    assert.equal(d?.namespace, undefined)
  })
  it('parses scoped purl (url-encoded @)', () => {
    // socket-sdk PURLs url-encode @ to %40 — the parser does not need
    // to round-trip-decode, just to peel off `{type}/{namespace}/{name}`.
    const d = depFromPurl('pkg:npm/%40types/node@20')
    assert.equal(d?.type, 'npm')
    assert.equal(d?.namespace, '%40types')
    assert.equal(d?.name, 'node')
  })
  it('parses purl without version', () => {
    const d = depFromPurl('pkg:cargo/serde')
    assert.equal(d?.type, 'cargo')
    assert.equal(d?.name, 'serde')
  })
  it('returns undefined for non-purl', () => {
    assert.equal(depFromPurl('lodash@4'), undefined)
    assert.equal(depFromPurl('pkg:'), undefined)
  })
})

// ============================================================================
// Unit tests: levenshtein + suggestSimilarName
// ============================================================================

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    assert.equal(levenshtein('foo', 'foo'), 0)
  })
  it('returns length when one side is empty', () => {
    assert.equal(levenshtein('', 'foo'), 3)
    assert.equal(levenshtein('foo', ''), 3)
  })
  it('handles a single substitution', () => {
    assert.equal(levenshtein('cat', 'bat'), 1)
  })
  it('handles a single insertion', () => {
    assert.equal(levenshtein('cat', 'cats'), 1)
  })
  it('handles a transposition (two edits)', () => {
    assert.equal(levenshtein('expres', 'express'), 1)
  })
  it('returns difference for very-different strings', () => {
    // Bailout path: returns rowMin once it exceeds 2.
    const d = levenshtein('totally-fake', 'lodash')
    assert.ok(d > 2)
  })
})

describe('suggestSimilarName', () => {
  it('suggests express for expres', () => {
    assert.equal(suggestSimilarName('npm', 'expres'), 'express')
  })
  it('suggests lodash for loadash', () => {
    assert.equal(suggestSimilarName('npm', 'loadash'), 'lodash')
  })
  it('returns undefined for nothing close enough', () => {
    assert.equal(suggestSimilarName('npm', 'totally-fake'), undefined)
  })
  it('returns undefined for unknown ecosystem', () => {
    assert.equal(suggestSimilarName('made-up', 'lodash'), undefined)
  })
  it('suggests requests for requets (pypi)', () => {
    assert.equal(suggestSimilarName('pypi', 'requets'), 'requests')
  })
})

// ============================================================================
// Unit tests: deriveSessionId
// ============================================================================

describe('deriveSessionId', () => {
  it('prefers explicit session_id over transcript_path', () => {
    const id = deriveSessionId({
      tool_name: 'Edit',
      session_id: 'sess-abc',
      transcript_path: '/foo/sess-zzz.jsonl',
    })
    assert.equal(id, 'sess-abc')
  })
  it('strips .jsonl from transcript path basename', () => {
    const id = deriveSessionId({
      tool_name: 'Edit',
      transcript_path: '/path/to/abc-1234.jsonl',
    })
    assert.equal(id, 'abc-1234')
  })
  it('returns undefined when neither is set', () => {
    assert.equal(deriveSessionId({ tool_name: 'Edit' }), undefined)
  })
})

// ============================================================================
// Unit tests: buildAuditRecords
// ============================================================================

describe('buildAuditRecords', () => {
  it('emits one record per dep with correct verdict mix', () => {
    const deps = [
      { type: 'npm', name: 'lodash' },
      { type: 'npm', name: 'evil-pkg' },
      { type: 'npm', name: 'ghost-pkg' },
      { type: 'npm', name: 'mystery-pkg' },
    ]
    const records = buildAuditRecords(
      {
        tool_name: 'Edit',
        session_id: 'sess-1',
      },
      deps,
      {
        blocked: [
          {
            purl: 'pkg:npm/evil-pkg',
            blocked: true,
            reason: 'malware — critical',
          },
        ],
        notFound: new Set(['pkg:npm/ghost-pkg']),
        ok: new Set(['pkg:npm/lodash']),
      },
    )
    assert.equal(records.length, 4)
    const byName = new Map(records.map(r => [r.name, r]))
    assert.equal(byName.get('lodash')?.verdict, 'allow')
    assert.equal(byName.get('evil-pkg')?.verdict, 'block')
    assert.equal(byName.get('evil-pkg')?.reason, 'malware — critical')
    assert.equal(byName.get('ghost-pkg')?.verdict, 'notfound')
    assert.equal(byName.get('mystery-pkg')?.verdict, 'unknown')
    // Session id flows through.
    for (let i = 0, { length } = records; i < length; i += 1) {
      const r = records[i]!
      assert.equal(r.session, 'sess-1')
    }
    // Repo basename is the cwd basename (which varies by where tests run).
    for (let i = 0, { length } = records; i < length; i += 1) {
      const r = records[i]!
      assert.ok(typeof r.repo === 'string' && r.repo.length > 0)
    }
  })
})

// ============================================================================
// Integration tests: audit log + 404 tracking
// ============================================================================

describe('audit log integration', () => {
  it('writes one jsonl record per checked dep', async () => {
    const home = makeTempHome()
    try {
      const r = runHook(
        {
          file_path: '/tmp/package.json',
          new_string: '"lodash": "^4.17.21"',
        },
        'Edit',
        { home, session_id: 'sess-audit-1' },
      )
      assert.equal(r.code, 0)
      const log = path.join(home, '.claude', 'audit', 'check-new-deps.jsonl')
      assert.ok(existsSync(log), 'audit log file should exist')
      const body = await fsp.readFile(log, 'utf8')
      const lines = body.trim().split('\n')
      assert.equal(lines.length, 1)
      const record = JSON.parse(lines[0]!) as Record<string, unknown>
      assert.equal(record['name'], 'lodash')
      assert.equal(record['type'], 'npm')
      assert.equal(record['session'], 'sess-audit-1')
      assert.equal(record['verdict'], 'allow')
      assert.equal(typeof record['ts'], 'number')
      assert.equal(typeof record['repo'], 'string')
    } finally {
      removeTempHome(home)
    }
  })

  it('appends records across multiple invocations', async () => {
    const home = makeTempHome()
    try {
      runHook(
        {
          file_path: '/tmp/package.json',
          new_string: '"lodash": "^4"',
        },
        'Edit',
        { home, session_id: 'sess-1' },
      )
      runHook(
        {
          file_path: '/tmp/package.json',
          new_string: '"express": "^4"',
        },
        'Edit',
        { home, session_id: 'sess-2' },
      )
      const log = path.join(home, '.claude', 'audit', 'check-new-deps.jsonl')
      const body = await fsp.readFile(log, 'utf8')
      const lines = body.trim().split('\n').filter(Boolean)
      assert.equal(lines.length, 2)
      const records = lines.map(l => JSON.parse(l) as Record<string, unknown>)
      const names = records.map(r => r['name']).toSorted()
      assert.deepEqual(names, ['express', 'lodash'])
    } finally {
      removeTempHome(home)
    }
  })

  it('records block verdict on malware hit', async () => {
    const home = makeTempHome()
    try {
      const r = runHook(
        {
          file_path: '/tmp/package.json',
          new_string: '"bradleymeck": "^1.0.0"',
        },
        'Edit',
        { home },
      )
      assert.equal(r.code, 2)
      const log = path.join(home, '.claude', 'audit', 'check-new-deps.jsonl')
      const body = await fsp.readFile(log, 'utf8')
      const lines = body.trim().split('\n').filter(Boolean)
      const blocked = lines
        .map(l => JSON.parse(l) as Record<string, unknown>)
        .find(r => r['verdict'] === 'block')
      assert.ok(blocked, 'should have a block record')
      assert.equal(blocked!['name'], 'bradleymeck')
      assert.ok(
        typeof blocked!['reason'] === 'string' &&
          (blocked!['reason'] as string).length > 0,
      )
    } finally {
      removeTempHome(home)
    }
  })

  it('writes nothing for non-manifest files', async () => {
    const home = makeTempHome()
    try {
      const r = runHook(
        {
          file_path: '/tmp/main.rs',
          new_string: 'fn main(){}',
        },
        'Edit',
        { home },
      )
      assert.equal(r.code, 0)
      const log = path.join(home, '.claude', 'audit', 'check-new-deps.jsonl')
      assert.equal(existsSync(log), false)
    } finally {
      removeTempHome(home)
    }
  })

  it('does not crash when audit dir is unwritable', async () => {
    // Point HOME at a path that already exists as a regular file so
    // mkdir of $HOME/.claude/audit fails with ENOTDIR. Hook must
    // still return its real verdict (allow for lodash) — exit 0.
    const home = path.join(os.tmpdir(), `check-new-deps-bad-home-${Date.now()}`)
    await fsp.writeFile(home, 'blocking file', 'utf8')
    try {
      const r = runHook(
        {
          file_path: '/tmp/package.json',
          new_string: '"lodash": "^4"',
        },
        'Edit',
        { home },
      )
      assert.equal(r.code, 0, 'unwritable audit must not fail the hook')
    } finally {
      if (existsSync(home)) {
        rmSync(home, { force: true })
      }
    }
  })
})
