// node --test specs for scripts/check-lock-step-refs.mts.
//
// The script is the CI-gate side of the Lock-step convention. It walks
// the scan dirs declared in .config/lock-step-refs.json, greps every
// canonical `Lock-step (with|from) <Lang>: <path>` comment, and fails
// when the path doesn't resolve. Companion edit-time hook is
// .claude/hooks/lock-step-ref-guard/.
//
// Test strategy: build a tmpdir repo with a known set of source files +
// a config + (optionally) the target files the refs claim. Spawn the
// script from that cwd and inspect exit code + stderr/stdout. Each test
// owns its own tmpdir to avoid cross-pollution.

import { spawnSync } from '@socketsecurity/lib-stable/spawn/spawn'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(here, '..', 'check-lock-step-refs.mts')

interface RepoSpec {
  readonly configContent?: string | undefined
  readonly files: Readonly<Record<string, string>>
}

function makeRepo(spec: RepoSpec): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'clsr-'))
  if (spec.configContent !== undefined) {
    mkdirSync(path.join(root, '.config'), { recursive: true })
    writeFileSync(
      path.join(root, '.config', 'lock-step-refs.json'),
      spec.configContent,
    )
  }
  for (const [rel, content] of Object.entries(spec.files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function runGate(
  cwd: string,
  args: readonly string[] = [],
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [SCRIPT_PATH, ...args], {
    cwd,
  })
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
    exitCode: result.status ?? -1,
  }
}

test('exits 0 cleanly when .config/lock-step-refs.json is absent', () => {
  const repo = makeRepo({ files: {} })
  const { exitCode, stdout } = runGate(repo)
  assert.equal(exitCode, 0)
  assert.match(stdout, /opt-in gate disabled/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 2 when config is malformed JSON', () => {
  const repo = makeRepo({
    configContent: '{ not valid json',
    files: {},
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 2)
  assert.match(stderr, /not valid JSON/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 2 when config is missing "roots"', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({ scan: [], extensions: [] }),
    files: {},
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 2)
  assert.match(stderr, /missing required "roots"/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 0 when all refs resolve', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'crates/parser/src/class.rs': '',
      'src/parser/class.go':
        '//! Lock-step from Rust: parser/src/class.rs\npackage parser',
    },
  })
  const { exitCode, stdout } = runGate(repo)
  assert.equal(exitCode, 0)
  assert.match(stdout, /scanned \d+ files — clean/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 1 when a ref points at a missing path', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/parser/class.go':
        '//! Lock-step from Rust: parser-stmt/src/class.rs\npackage parser',
    },
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 1)
  assert.match(stderr, /stale reference/)
  assert.match(stderr, /parser-stmt\/src\/class\.rs/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 1 when <Lang> is not in roots config', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/parser/class.go':
        '//! Lock-step from Bash: scripts/run.sh\npackage parser',
    },
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 1)
  assert.match(stderr, /unknown <Lang>/)
  rmSync(repo, { recursive: true, force: true })
})

test('does NOT match prose "Lock-step with Go: JSON parser"', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Go: ['src'] },
      scan: ['src'],
      extensions: ['.rs'],
    }),
    files: {
      'src/foo.rs':
        '// Lock-step with Go: JSON parser semantics are subtle.\nfn x() {}',
    },
  })
  const { exitCode, stdout } = runGate(repo)
  assert.equal(exitCode, 0)
  assert.match(stdout, /clean/)
  rmSync(repo, { recursive: true, force: true })
})

test('accepts inline ref with line range', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Go: ['src'] },
      scan: ['src'],
      extensions: ['.rs'],
    }),
    files: {
      'src/parser.go': '',
      'src/foo.rs': '// Lock-step with Go: src/parser.go:6450-6457\nfn x() {}',
    },
  })
  const { exitCode } = runGate(repo)
  assert.equal(exitCode, 0)
  rmSync(repo, { recursive: true, force: true })
})

test('--json emits machine-readable findings', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/foo.go':
        '//! Lock-step from Rust: parser-stmt/src/x.rs\npackage foo',
    },
  })
  const { exitCode, stdout } = runGate(repo, ['--json'])
  assert.equal(exitCode, 1)
  const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>
  assert.ok(Array.isArray(parsed))
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!['lang'], 'Rust')
  assert.equal(parsed[0]!['reason'], 'path-not-found')
  rmSync(repo, { recursive: true, force: true })
})

test('--quiet suppresses clean-run stdout', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'crates/parser/src/class.rs': '',
      'src/parser/class.go':
        '//! Lock-step from Rust: parser/src/class.rs\npackage parser',
    },
  })
  const { exitCode, stdout } = runGate(repo, ['--quiet'])
  assert.equal(exitCode, 0)
  assert.equal(stdout, '')
  rmSync(repo, { recursive: true, force: true })
})

test('skips SKIP_DIRS (node_modules, dist, target)', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      // These should be IGNORED — stale ref inside node_modules/ shouldn't fail the gate.
      'src/node_modules/junk/file.go':
        '//! Lock-step from Rust: doesnotexist.rs\npackage x',
      'src/dist/x.go': '//! Lock-step from Rust: doesnotexist.rs\npackage x',
      'src/target/x.go': '//! Lock-step from Rust: doesnotexist.rs\npackage x',
    },
  })
  const { exitCode } = runGate(repo)
  assert.equal(exitCode, 0)
  rmSync(repo, { recursive: true, force: true })
})

test('resolves path against repo-root before per-lang roots', () => {
  // A Rust file in ultrathink references `parser.go` — root-relative form
  // (the Go impl tree puts parser.go where it does without lang-prefix).
  // Should resolve when EITHER repo-root OR <lang>-root contains it.
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Go: ['langs/go/src'] },
      scan: ['langs/rust'],
      extensions: ['.rs'],
    }),
    files: {
      // Found via root-relative path resolution.
      'parser.go': '',
      'langs/rust/foo.rs': '// Lock-step with Go: parser.go:42\nfn x() {}',
    },
  })
  const { exitCode } = runGate(repo)
  assert.equal(exitCode, 0)
  rmSync(repo, { recursive: true, force: true })
})

test('reports findings grouped by file', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    files: {
      'src/a.go':
        '//! Lock-step from Rust: stale-a.rs\n// Lock-step with Rust: stale-b.rs\npackage a',
      'src/b.go': '//! Lock-step from Rust: stale-c.rs\npackage b',
    },
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 1)
  // Three findings across two files.
  assert.match(stderr, /3 stale reference/)
  // File-grouped: each file appears once in the output even with multiple hits.
  assert.match(stderr, /src\/a\.go/)
  assert.match(stderr, /src\/b\.go/)
  rmSync(repo, { recursive: true, force: true })
})
