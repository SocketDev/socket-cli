// node --test specs for scripts/fleet/check-lock-step-header.mts.
//
// The header gate is the §7 companion to §5–6 path-refs gate. Where
// check-lock-step-refs.mts validates that named paths resolve, this
// gate validates that the `BEGIN LOCK-STEP HEADER` / `END LOCK-STEP
// HEADER` block is byte-identical across every member of a quadruplet.
//
// Test strategy: build a tmpdir repo with a canonical file (Rust)
// whose header lists peers + the peer files themselves, vary the
// peers' headers, and inspect exit code + stderr.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(here, '..', 'check-lock-step-header.mts')

interface RepoSpec {
  readonly configContent?: string | undefined
  readonly files: Readonly<Record<string, string>>
}

function makeRepo(spec: RepoSpec): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'clsh-'))
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

const CANONICAL_HEADER = [
  '// BEGIN LOCK-STEP HEADER',
  '// Class Parsing',
  '//',
  '// Lock-step with Go: src/class.go',
  '// END LOCK-STEP HEADER',
  '',
  'fn parse_class() {}',
].join('\n')

const MATCHING_PEER_HEADER = [
  '// BEGIN LOCK-STEP HEADER',
  '// Class Parsing',
  '//',
  '// Lock-step with Go: src/class.go',
  '// END LOCK-STEP HEADER',
  '',
  'package parser',
].join('\n')

const DRIFTED_PEER_HEADER = [
  '// BEGIN LOCK-STEP HEADER',
  '// Class Parsing (with extra prose)', // ← divergence
  '//',
  '// Lock-step with Go: src/class.go',
  '// END LOCK-STEP HEADER',
  '',
  'package parser',
].join('\n')

const STD_CONFIG = JSON.stringify({
  roots: { Rust: ['crates'], Go: ['src'] },
  scan: ['crates', 'src'],
  extensions: ['.rs', '.go'],
})

test('exits 0 when config is absent', () => {
  const repo = makeRepo({ files: {} })
  const { exitCode, stdout } = runGate(repo)
  assert.equal(exitCode, 0)
  assert.match(stdout, /opt-in gate disabled/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 0 when no files carry a BEGIN LOCK-STEP HEADER block', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': 'fn x() {}',
      'src/class.go': 'package parser',
    },
  })
  const { exitCode, stdout } = runGate(repo)
  assert.equal(exitCode, 0)
  assert.match(stdout, /validated 0 canonical header/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 0 when canonical + peer headers are byte-identical', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      'src/class.go': MATCHING_PEER_HEADER,
    },
  })
  const { exitCode, stdout } = runGate(repo)
  assert.equal(exitCode, 0)
  // Both files carry `Lock-step with Go:` — same shared canonical header —
  // so both are counted as canonical. Each validates the other; both clean.
  assert.match(stdout, /validated \d+ canonical header.*clean/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 1 when peer header drifts from canonical', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      'src/class.go': DRIFTED_PEER_HEADER,
    },
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 1)
  assert.match(stderr, /1 quadruplet diff/)
  assert.match(stderr, /with extra prose/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 1 when peer is missing its LOCK-STEP HEADER block', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      'src/class.go': 'package parser', // no header at all
    },
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 1)
  assert.match(stderr, /peer is missing its BEGIN LOCK-STEP HEADER block/)
  rmSync(repo, { recursive: true, force: true })
})

test('exits 1 when peer file does not exist', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      // src/class.go intentionally missing
    },
  })
  const { exitCode, stderr } = runGate(repo)
  assert.equal(exitCode, 1)
  assert.match(stderr, /peer path doesn't exist/)
  rmSync(repo, { recursive: true, force: true })
})

test('--json emits machine-readable diffs', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      'src/class.go': DRIFTED_PEER_HEADER,
    },
  })
  const { exitCode, stdout } = runGate(repo, ['--json'])
  assert.equal(exitCode, 1)
  const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!['lang'], 'Go')
  assert.equal(parsed[0]!['reason'], 'body-mismatch')
  rmSync(repo, { recursive: true, force: true })
})

test('--quiet suppresses clean-run stdout', () => {
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      'src/class.go': MATCHING_PEER_HEADER,
    },
  })
  const { exitCode, stdout } = runGate(repo, ['--quiet'])
  assert.equal(exitCode, 0)
  assert.equal(stdout, '')
  rmSync(repo, { recursive: true, force: true })
})

test('header body comparison ignores leading whitespace after // prefix', () => {
  // Both files use `// content` — same prefix stripping. The content
  // bytes must match exactly.
  const repo = makeRepo({
    configContent: STD_CONFIG,
    files: {
      'crates/parser/src/class.rs': CANONICAL_HEADER,
      'src/class.go': [
        '// BEGIN LOCK-STEP HEADER',
        '// Class Parsing',
        '//',
        '// Lock-step with Go: src/class.go',
        '// END LOCK-STEP HEADER',
        '',
        'package parser',
      ].join('\n'),
    },
  })
  const { exitCode } = runGate(repo)
  assert.equal(exitCode, 0)
  rmSync(repo, { recursive: true, force: true })
})

test('handles multi-peer canonical file', () => {
  const multiPeerHeader = [
    '// BEGIN LOCK-STEP HEADER',
    '// Class Parsing',
    '//',
    '// Lock-step with Go: src/class.go',
    '// Lock-step with C++: cpp/class.cpp',
    '// END LOCK-STEP HEADER',
  ].join('\n')
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'], Go: ['src'], 'C++': ['cpp'] },
      scan: ['crates', 'src', 'cpp'],
      extensions: ['.rs', '.go', '.cpp'],
    }),
    files: {
      'crates/parser/src/class.rs': multiPeerHeader + '\nfn x() {}',
      'src/class.go': multiPeerHeader + '\npackage parser',
      'cpp/class.cpp': multiPeerHeader + '\nvoid x() {}',
    },
  })
  const { exitCode } = runGate(repo)
  assert.equal(exitCode, 0)
  rmSync(repo, { recursive: true, force: true })
})
