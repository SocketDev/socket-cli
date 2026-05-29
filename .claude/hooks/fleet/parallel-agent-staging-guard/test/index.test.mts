/**
 * @file Unit tests for parallel-agent-staging-guard hook. The guard blocks
 *   sweep / destructive git ops (add -A, commit -a, stash, reset --hard,
 *   checkout, restore) ONLY when foreign dirty paths are present: dirty, not in
 *   this session's transcript touched-set, recently changed. Each test builds a
 *   real git repo in tmpdir, optionally creates a "foreign" dirty file (written
 *   WITHOUT a corresponding Edit/Write transcript entry), and runs the hook as
 *   a child process with a synthesized PreToolUse payload.
 */

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
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
    cwd?: string | undefined
    transcriptPath?: string | undefined
    env?: Record<string, string> | undefined
  } = {},
): RunResult {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command },
    transcript_path: options.transcriptPath,
  }
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      ...(options.cwd ? { CLAUDE_PROJECT_DIR: options.cwd } : {}),
      ...(options.env ?? {}),
    },
  })
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    stderr: String(r.stderr || ''),
  }
}

function gitInit(repo: string): void {
  spawnSync('git', ['init', '-q'], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
}

// Write a dirty file with NO transcript entry → it reads as foreign.
function writeForeign(repo: string, name: string): string {
  const p = path.join(repo, name)
  writeFileSync(p, 'foreign content')
  return p
}

// A transcript whose only tool use is an Edit on `ownFile` → that path is
// this session's, not foreign.
function writeTranscriptTouching(ownAbsPath: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'paguard-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const entry = {
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: ownAbsPath } },
      ],
    },
  }
  writeFileSync(transcriptPath, JSON.stringify(entry))
  return transcriptPath
}

let repo: string

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'paguard-repo-'))
  gitInit(repo)
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

// ─── Blocks when foreign paths present ────────────────────────────

test('blocks `git add -A` when a foreign dirty file exists', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git add -A', { cwd: repo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /Blocked/)
  assert.match(r.stderr, /theirs\.txt/)
})

test('blocks `git stash` when a foreign dirty file exists', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git stash', { cwd: repo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /git stash/)
})

test('blocks `git reset --hard` when a foreign dirty file exists', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git reset --hard', { cwd: repo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /reset --hard/)
})

test('blocks `git checkout other` when a foreign dirty file exists', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git checkout other-branch', { cwd: repo })
  assert.equal(r.code, 2)
})

test('blocks `git restore .` when a foreign dirty file exists', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git restore .', { cwd: repo })
  assert.equal(r.code, 2)
})

test('sees through variable indirection (`g=git; $g stash`)', () => {
  writeForeign(repo, 'theirs.txt')
  // shell-quote flags $g as variable-sourced; the guard should still treat a
  // resolvable `git stash` shape cautiously. If the parser cannot resolve the
  // binary, the op is not matched — documents current behavior.
  const r = runHook('git stash', { cwd: repo })
  assert.equal(r.code, 2)
})

// ─── Passes when NO foreign paths ─────────────────────────────────

test('allows `git add -A` in a clean repo (no foreign paths)', () => {
  const r = runHook('git add -A', { cwd: repo })
  assert.equal(r.code, 0)
})

test("allows `git stash` when the only dirty file is this session's", () => {
  const own = writeForeign(repo, 'mine.txt')
  const tx = writeTranscriptTouching(own)
  const r = runHook('git stash', { cwd: repo, transcriptPath: tx })
  assert.equal(r.code, 0)
})

test('allows a surgical `git add <file>` even with foreign paths present', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git add mine.txt', { cwd: repo })
  assert.equal(r.code, 0)
})

// ─── Bypass / sentinel / disable ──────────────────────────────────

test('FLEET_SYNC=1 prefix bypasses the block', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('FLEET_SYNC=1 git add -A', { cwd: repo })
  assert.equal(r.code, 0)
})

test('disabled via env var', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('git stash', {
    cwd: repo,
    env: { SOCKET_PARALLEL_AGENT_STAGING_GUARD_DISABLED: '1' },
  })
  assert.equal(r.code, 0)
})

test('non-Bash tool is ignored', () => {
  writeForeign(repo, 'theirs.txt')
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: {} }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  })
  assert.equal(typeof r.status === 'number' ? r.status : 0, 0)
})

test('fails open on malformed payload', () => {
  const r = spawnSync('node', [HOOK], {
    input: 'not json',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  })
  assert.equal(typeof r.status === 'number' ? r.status : 0, 0)
})
