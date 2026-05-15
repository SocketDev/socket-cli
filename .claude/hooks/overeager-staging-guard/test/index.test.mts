/**
 * @fileoverview Unit tests for overeager-staging-guard hook.
 *
 * Two layers under test:
 *   1. Layer 1 — block `git add -A` / `.` / `-u` (exit 2).
 *   2. Layer 2 — informational warning on `git commit` when index
 *      contains files not touched by this session (exit 0 + stderr).
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, test } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  readonly code: number
  readonly stderr: string
}

function runHook(
  command: string,
  options: {
    cwd?: string
    transcriptPath?: string
    env?: Record<string, string>
  } = {},
): RunResult {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command },
    transcript_path: options.transcriptPath,
  }
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.cwd ? { CLAUDE_PROJECT_DIR: options.cwd } : {}),
      ...(options.env ?? {}),
    },
  })
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    stderr: r.stderr || '',
  }
}

function gitInit(repo: string): void {
  spawnSync('git', ['init', '-q'], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repo,
  })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
}

function gitAdd(repo: string, files: string[]): void {
  spawnSync('git', ['add', ...files], { cwd: repo })
}

function writeTranscript(entries: object[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'overeager-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    entries.map(e => JSON.stringify(e)).join('\n'),
  )
  return transcriptPath
}

let tmpRepo: string

beforeEach(() => {
  tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'overeager-repo-'))
  gitInit(tmpRepo)
})

afterEach(() => {
  rmSync(tmpRepo, { recursive: true, force: true })
})

// ─── Layer 1: broad git-add blocking ──────────────────────────────

test('blocks `git add -A`', () => {
  const r = runHook('git add -A', { cwd: tmpRepo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /git add -A/)
  assert.match(r.stderr, /Blocked/)
})

test('blocks `git add --all`', () => {
  const r = runHook('git add --all', { cwd: tmpRepo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /git add --all/)
})

test('blocks `git add .`', () => {
  const r = runHook('git add .', { cwd: tmpRepo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /git add \./)
})

test('blocks `git add -u`', () => {
  const r = runHook('git add -u', { cwd: tmpRepo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /git add -u/)
})

test('blocks `git add --update`', () => {
  const r = runHook('git add --update', { cwd: tmpRepo })
  assert.equal(r.code, 2)
})

test('blocks broad add chained after another command', () => {
  const r = runHook('echo hi && git add -A && git commit -m x', {
    cwd: tmpRepo,
  })
  assert.equal(r.code, 2)
})

test('blocks broad add when env vars are set on the command', () => {
  const r = runHook('GIT_AUTHOR_NAME=foo git add .', { cwd: tmpRepo })
  assert.equal(r.code, 2)
})

test('allows `git add path/to/file.ts`', () => {
  const r = runHook('git add src/foo.ts', { cwd: tmpRepo })
  assert.equal(r.code, 0)
})

test('allows `git add ./relative-path.ts` (not a broad sweep)', () => {
  const r = runHook('git add ./src/foo.ts', { cwd: tmpRepo })
  assert.equal(r.code, 0)
})

test('allows `git add multiple specific files`', () => {
  const r = runHook('git add src/a.ts src/b.ts test/c.test.ts', {
    cwd: tmpRepo,
  })
  assert.equal(r.code, 0)
})

test('allows `git commit -m`', () => {
  const r = runHook('git commit -m "fix: thing"', { cwd: tmpRepo })
  assert.equal(r.code, 0)
})

test('allows non-git Bash commands', () => {
  const r = runHook('ls -la', { cwd: tmpRepo })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('bypass: `Allow add-all bypass` in transcript allows broad add', () => {
  const transcriptPath = writeTranscript([
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Allow add-all bypass' }],
      },
    },
  ])
  const r = runHook('git add -A', { cwd: tmpRepo, transcriptPath })
  assert.equal(r.code, 0)
})

test('env disable short-circuits', () => {
  const r = runHook('git add -A', {
    cwd: tmpRepo,
    env: { SOCKET_OVEREAGER_STAGING_GUARD_DISABLED: '1' },
  })
  assert.equal(r.code, 0)
})

// ─── Layer 2: warn on git commit with unfamiliar staged files ─────

test('git commit with empty index passes silently', () => {
  const r = runHook('git commit -m "x"', { cwd: tmpRepo })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('git commit warns when index has files not touched this session', () => {
  writeFileSync(path.join(tmpRepo, 'parallel.ts'), '// other agent')
  gitAdd(tmpRepo, ['parallel.ts'])
  // Empty transcript — agent touched nothing.
  const transcriptPath = writeTranscript([])
  const r = runHook('git commit -m "mine"', {
    cwd: tmpRepo,
    transcriptPath,
  })
  // Layer 2 is informational — exit 0 with stderr warning.
  assert.equal(r.code, 0)
  assert.match(r.stderr, /parallel\.ts/)
  assert.match(r.stderr, /not touched/)
})

test('git commit silent when index files match transcript Edit history', () => {
  const myFile = path.join(tmpRepo, 'mine.ts')
  writeFileSync(myFile, '// mine')
  gitAdd(tmpRepo, ['mine.ts'])
  const transcriptPath = writeTranscript([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Edit',
            input: { file_path: myFile },
          },
        ],
      },
    },
  ])
  const r = runHook('git commit -m "mine"', {
    cwd: tmpRepo,
    transcriptPath,
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('git commit silent when index files match transcript git-add history', () => {
  const myFile = path.join(tmpRepo, 'mine.ts')
  writeFileSync(myFile, '// mine')
  gitAdd(tmpRepo, ['mine.ts'])
  const transcriptPath = writeTranscript([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: `git add ${myFile}` },
          },
        ],
      },
    },
  ])
  const r = runHook('git commit -m "mine"', {
    cwd: tmpRepo,
    transcriptPath,
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

// ─── Misc edge cases ──────────────────────────────────────────────

test('non-Bash tool_name is ignored', () => {
  const r = spawnSync(
    'node',
    [HOOK],
    {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/foo' },
      }),
      encoding: 'utf8',
    },
  )
  assert.equal(r.status, 0)
})

test('malformed payload is ignored (fail-open)', () => {
  const r = spawnSync('node', [HOOK], {
    input: 'not-json',
    encoding: 'utf8',
  })
  assert.equal(r.status, 0)
})

test('empty command is ignored', () => {
  const r = runHook('', { cwd: tmpRepo })
  assert.equal(r.code, 0)
})
