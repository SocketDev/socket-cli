/**
 * @file Unit tests for parallel-agent-edit-guard hook. The guard blocks an Edit
 *   / Write / NotebookEdit whose target file is foreign: dirty in the checkout,
 *   not in this session's transcript touched-set, recently changed. Editing
 *   your own file, a fresh file, or any file when no parallel agent is active
 *   passes through. Each test builds a real git repo in tmpdir, optionally
 *   creates a "foreign" dirty file (written WITHOUT a transcript entry), and
 *   runs the hook as a child process with a synthesized PreToolUse payload.
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
  filePath: string,
  options: {
    toolName?: string | undefined
    cwd?: string | undefined
    transcriptPath?: string | undefined
    env?: Record<string, string> | undefined
  } = {},
): RunResult {
  const payload = {
    tool_name: options.toolName ?? 'Write',
    tool_input: { file_path: filePath },
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

// A transcript whose only tool use is an Edit on `ownAbsPath` → that path is
// this session's, not foreign.
function writeTranscriptTouching(ownAbsPath: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'paeguard-tx-'))
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
  repo = mkdtempSync(path.join(os.tmpdir(), 'paeguard-repo-'))
  gitInit(repo)
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

// ─── Blocks when the target is foreign ────────────────────────────

test('blocks Write to a foreign dirty file', () => {
  const theirs = writeForeign(repo, 'theirs.txt')
  const r = runHook(theirs, { cwd: repo })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /Blocked/)
  assert.match(r.stderr, /theirs\.txt/)
})

test('blocks Edit to a foreign dirty file', () => {
  const theirs = writeForeign(repo, 'theirs.txt')
  const r = runHook(theirs, { cwd: repo, toolName: 'Edit' })
  assert.equal(r.code, 2)
})

test('blocks NotebookEdit to a foreign dirty file', () => {
  const theirs = writeForeign(repo, 'theirs.ipynb')
  const r = runHook(theirs, { cwd: repo, toolName: 'NotebookEdit' })
  assert.equal(r.code, 2)
})

test('foreign target matches via a repo-relative file_path', () => {
  writeForeign(repo, 'theirs.txt')
  const r = runHook('theirs.txt', { cwd: repo })
  assert.equal(r.code, 2)
})

// ─── Passes ───────────────────────────────────────────────────────

test("allows editing THIS session's own dirty file", () => {
  const own = writeForeign(repo, 'mine.txt')
  const tx = writeTranscriptTouching(own)
  const r = runHook(own, { cwd: repo, transcriptPath: tx })
  assert.equal(r.code, 0)
})

test("allows editing a foreign file's NEIGHBOR (different file)", () => {
  writeForeign(repo, 'theirs.txt')
  // Target is a fresh file the other agent isn't touching.
  const r = runHook(path.join(repo, 'ours-new.txt'), { cwd: repo })
  assert.equal(r.code, 0)
})

test('allows editing a fresh file in a clean repo (no foreign paths)', () => {
  const r = runHook(path.join(repo, 'new.txt'), { cwd: repo })
  assert.equal(r.code, 0)
})

// ─── Bypass / sentinel / disable ──────────────────────────────────

test('FLEET_SYNC=1 env bypasses the block', () => {
  const theirs = writeForeign(repo, 'theirs.txt')
  const r = runHook(theirs, { cwd: repo, env: { FLEET_SYNC: '1' } })
  assert.equal(r.code, 0)
})

test('disabled via env var', () => {
  const theirs = writeForeign(repo, 'theirs.txt')
  const r = runHook(theirs, {
    cwd: repo,
    env: { SOCKET_PARALLEL_AGENT_EDIT_GUARD_DISABLED: '1' },
  })
  assert.equal(r.code, 0)
})

test('non-edit tool is ignored', () => {
  writeForeign(repo, 'theirs.txt')
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    }),
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
