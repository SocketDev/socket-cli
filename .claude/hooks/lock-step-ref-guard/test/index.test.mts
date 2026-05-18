import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(userText?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lsrg-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: userText ?? 'normal message' }),
  )
  return transcriptPath
}

function makeRepo(
  opts: {
    configContent?: string
    existingFiles?: readonly string[]
  } = {},
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'lsrg-repo-'))
  if (opts.configContent !== undefined) {
    mkdirSync(path.join(root, '.config'), { recursive: true })
    writeFileSync(
      path.join(root, '.config', 'lock-step-refs.json'),
      opts.configContent,
    )
  }
  for (const rel of opts.existingFiles ?? []) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, '')
  }
  return root
}

function runHook(
  tool: 'Edit' | 'Write' | 'Read',
  filePath: string,
  content: string,
  options: {
    transcriptPath?: string
    env?: Record<string, string>
    cwd?: string
  } = {},
): { stderr: string; exitCode: number } {
  const payload: Record<string, unknown> = {
    tool_name: tool,
    tool_input: { file_path: filePath, content, new_string: content },
  }
  if (options.transcriptPath) {
    payload['transcript_path'] = options.transcriptPath
  }
  if (options.cwd) {
    payload['cwd'] = options.cwd
  }
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

// MALFORMED — always fires, regardless of config presence

test('FLAGS lowercase "lockstep with Go: parser.go"', () => {
  const content = '// lockstep with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /lock-step-ref-guard/)
  assert.match(stderr, /Lock-step.*hyphen|Lock-step.*Lock step/)
})

test('FLAGS unhyphenated "Lock step with Go: parser.go"', () => {
  const content = '// Lock step with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /hyphen/)
})

test('FLAGS missing discriminator "Lock-step Rust: src/foo.rs"', () => {
  const content = '// Lock-step Rust: src/foo.rs\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.go', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /discriminator/)
})

test('FLAGS missing <Lang> "Lock-step with : src/foo.rs"', () => {
  const content = '// Lock-step with : src/foo.rs\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.go', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /<Lang>/)
})

test('FLAGS comma-instead-of-colon "Lock-step with Go, parser.go"', () => {
  const content = '// Lock-step with Go, parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /":".*","|"," instead of ":"/)
})

// CANONICAL forms — accepted

test('ACCEPTS canonical "Lock-step with Go: parser.go" (no config)', () => {
  const content = '// Lock-step with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  // Without a config, no stale-check runs; the canonical form passes silently.
  assert.equal(stderr, '')
})

test('ACCEPTS file-level "//! Lock-step from Rust: crates/parser/src/class.rs"', () => {
  const content =
    '//! Lock-step from Rust: crates/parser/src/class.rs\npackage parser'
  const { stderr, exitCode } = runHook(
    'Write',
    '/repo/src/parser/class.go',
    content,
  )
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ACCEPTS "Lock-step note: <freeform>" without flagging', () => {
  const content = [
    '// Lock-step note: reshaped for borrowck — Zig used a raw pointer here.',
    'const x = 1',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

// STALE — fires only when config is present

test('FLAGS stale path when config opts in', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
  })
  const content =
    '// Lock-step with Rust: crates/parser-stmt/src/foo.rs\nconst x = 1'
  const { stderr, exitCode } = runHook(
    'Write',
    path.join(repo, 'src/foo.go'),
    content,
    { cwd: repo },
  )
  assert.equal(exitCode, 0)
  assert.match(stderr, /Stale Lock-step reference/)
  assert.match(stderr, /path not found/)
})

test('ACCEPTS stale path when config absent (opt-in disabled)', () => {
  const repo = makeRepo() // no config
  const content =
    '// Lock-step with Rust: crates/parser-stmt/src/foo.rs\nconst x = 1'
  const { stderr, exitCode } = runHook(
    'Write',
    path.join(repo, 'src/foo.go'),
    content,
    { cwd: repo },
  )
  assert.equal(exitCode, 0)
  // Stale-check disabled; the canonical form is shape-correct so no malformed flag.
  assert.equal(stderr, '')
})

test('ACCEPTS resolvable path when config opts in', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
    existingFiles: ['crates/parser/src/class.rs'],
  })
  const content = '// Lock-step with Rust: parser/src/class.rs\nconst x = 1'
  const { stderr, exitCode } = runHook(
    'Write',
    path.join(repo, 'src/foo.go'),
    content,
    { cwd: repo },
  )
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('FLAGS unknown <Lang> when config opts in', () => {
  const repo = makeRepo({
    configContent: JSON.stringify({
      roots: { Rust: ['crates'] },
      scan: ['src'],
      extensions: ['.go'],
    }),
  })
  const content = '// Lock-step with Bash: scripts/x.sh\nconst x = 1'
  const { stderr, exitCode } = runHook(
    'Write',
    path.join(repo, 'src/foo.go'),
    content,
    { cwd: repo },
  )
  assert.equal(exitCode, 0)
  assert.match(stderr, /unknown <Lang>/)
})

// FALSE-POSITIVE GUARD — prose with "Lock-step with Go: JSON"

test('does NOT match prose "Lock-step with Go: JSON parser semantics"', () => {
  const content = [
    '// Lock-step with Go: JSON parser semantics here are tricky.',
    'const x = 1',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  // The path regex requires `.` or `/`. "JSON" has neither, so no canonical
  // match fires. The shape is also not a recognized malformed pattern.
  assert.equal(stderr, '')
})

// SCOPE — skip non-source files

test('SKIPS Markdown files', () => {
  const content = '// lockstep with Go: parser.go\nsome prose'
  const { stderr, exitCode } = runHook('Write', '/repo/README.md', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('SKIPS test files', () => {
  const content = '// lockstep with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook(
    'Write',
    '/repo/test/parser.test.ts',
    content,
  )
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('SKIPS Read tool calls', () => {
  const content = '// lockstep with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Read', '/repo/src/foo.rs', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

// BYPASS

test('BYPASS via "Allow lock-step bypass" user message', () => {
  const transcriptPath = makeTranscript('Allow lock-step bypass')
  const content = '// lockstep with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content, {
    transcriptPath,
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('BYPASS via SOCKET_LOCK_STEP_REF_GUARD_DISABLED=1', () => {
  const content = '// lockstep with Go: parser.go\nconst x = 1'
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.rs', content, {
    env: { SOCKET_LOCK_STEP_REF_GUARD_DISABLED: '1' },
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

// HARDENING — bad payloads don't crash

test('exits 0 on invalid JSON payload', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: 'not-json',
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})

test('exits 0 on missing tool_input', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ tool_name: 'Write' }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})
