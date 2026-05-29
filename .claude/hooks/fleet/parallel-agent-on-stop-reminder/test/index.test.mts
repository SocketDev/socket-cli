/**
 * @file Unit tests for parallel-agent-on-stop-reminder hook. Stop hook, always
 *   exit 0. Emits a stderr reminder listing dirty paths this session did not
 *   author and that changed recently. Each test builds a real git repo in
 *   tmpdir, writes foreign / own dirty files, and runs the hook as a child
 *   process with a synthesized Stop payload.
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
  options: {
    cwd?: string | undefined
    transcriptPath?: string | undefined
    env?: Record<string, string> | undefined
  } = {},
): RunResult {
  const payload = { transcript_path: options.transcriptPath }
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

function writeFile(repo: string, name: string): string {
  const p = path.join(repo, name)
  writeFileSync(p, 'content')
  return p
}

function writeTranscriptTouching(ownAbsPath: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pareminder-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const entry = {
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Write', input: { file_path: ownAbsPath } },
      ],
    },
  }
  writeFileSync(transcriptPath, JSON.stringify(entry))
  return transcriptPath
}

let repo: string

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'pareminder-repo-'))
  gitInit(repo)
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

test('always exits 0', () => {
  writeFile(repo, 'theirs.txt')
  assert.equal(runHook({ cwd: repo }).code, 0)
})

test('reminds when a foreign dirty file exists (no transcript)', () => {
  writeFile(repo, 'theirs.txt')
  const r = runHook({ cwd: repo })
  assert.match(r.stderr, /parallel-agent-on-stop-reminder/)
  assert.match(r.stderr, /theirs\.txt/)
  assert.match(r.stderr, /another (Claude )?session|another agent/i)
})

test("silent when the only dirty file is this session's", () => {
  const own = writeFile(repo, 'mine.txt')
  const tx = writeTranscriptTouching(own)
  const r = runHook({ cwd: repo, transcriptPath: tx })
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.stderr, /mine\.txt/)
})

test('silent on a clean repo', () => {
  const r = runHook({ cwd: repo })
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.stderr, /parallel-agent-on-stop-reminder.*dirty/s)
})

test('ignores untracked-by-default trees (vendor/)', () => {
  spawnSync('mkdir', ['-p', path.join(repo, 'vendor')], { cwd: repo })
  writeFile(repo, path.join('vendor', 'dep.js'))
  const r = runHook({ cwd: repo })
  assert.doesNotMatch(r.stderr, /vendor\/dep\.js/)
})

test('disabled via env var', () => {
  writeFile(repo, 'theirs.txt')
  const r = runHook({
    cwd: repo,
    env: { SOCKET_PARALLEL_AGENT_REMINDER_DISABLED: '1' },
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr.trim(), '')
})

test('fails open on malformed payload', () => {
  writeFile(repo, 'theirs.txt')
  const r = spawnSync('node', [HOOK], {
    input: 'not json',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  })
  // No transcript → empty touched-set → still lists foreign, but never crashes.
  assert.equal(typeof r.status === 'number' ? r.status : 0, 0)
})
