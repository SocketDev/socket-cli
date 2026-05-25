// node --test specs for the pr-vs-push-default-reminder hook.

import { spawn, spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function mkRepoOnBranch(branch: string): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'pr-vs-push-test-'))
  spawnSync('git', ['init', '-q', '-b', branch], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
  writeFileSync(path.join(repo, 'README.md'), 'x')
  spawnSync('git', ['add', '.'], { cwd: repo })
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
  return repo
}

function mkTranscript(userTurns: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pr-vs-push-tx-'))
  const p = path.join(dir, 'session.jsonl')
  const lines = userTurns.map(t =>
    JSON.stringify({ type: 'user', message: { content: t } }),
  )
  writeFileSync(p, lines.join('\n') + '\n')
  return p
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  // v6 lib-stable spawn returns an enriched Promise that rejects on
  // non-zero exit; this test reads stderr + exit via manual listeners
  // instead. Swallow the Promise rejection so it doesn't race the
  // listener-based resolve and trigger "async activity after test ended".
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-gh-pr-create Bash passes silently', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('gh pr create on feature branch — no reminder', async () => {
  const repo = mkRepoOnBranch('feat/x')
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['fix this']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('gh pr create on main with no PR directive — reminder fires', async () => {
  const repo = mkRepoOnBranch('main')
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['fix this']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('About to open a PR from main'))
})

test('gh pr create on main with "open a PR" directive — no reminder', async () => {
  const repo = mkRepoOnBranch('main')
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['open a PR for this']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('gh pr create on main with "pull request" directive — no reminder', async () => {
  const repo = mkRepoOnBranch('main')
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['fix this', 'send a pull request']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('gh pr create on master (legacy) without directive — reminder fires', async () => {
  const repo = mkRepoOnBranch('master')
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['ship it']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('About to open a PR'))
})
