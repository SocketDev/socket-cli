// node --test specs for the pr-vs-push-default-reminder hook.

import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function mkRepoOnBranch(branch: string, originUrl?: string): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'pr-vs-push-test-'))
  spawnSync('git', ['init', '-q', '-b', branch], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
  writeFileSync(path.join(repo, 'README.md'), 'x')
  spawnSync('git', ['add', '.'], { cwd: repo })
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
  if (originUrl) {
    spawnSync('git', ['remote', 'add', 'origin', originUrl], { cwd: repo })
  }
  return repo
}

// A canonical fleet repo origin (socket-registry is in the fleet roster).
const FLEET_ORIGIN = 'git@github.com:SocketDev/socket-registry.git'
// A non-fleet origin (a personal / outside repo).
const NON_FLEET_ORIGIN = 'git@github.com:someone/random-thing.git'

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
  assert.ok(String(r.stderr).includes('About to open a PR'))
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

test('gh pr create on a FLEET feature branch without directive — reminder fires', async () => {
  // The 2026-06-02 case: feature branch in a fleet repo, no PR directive.
  // Old hook skipped all non-main branches; now it nudges toward a direct
  // push to the default branch.
  const repo = mkRepoOnBranch('feat/x', FLEET_ORIGIN)
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['land it']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('fleet feature branch'))
  assert.ok(String(r.stderr).includes('feat/x:'))
})

test('gh pr create on a NON-fleet feature branch — no reminder', async () => {
  // PR-from-feature-branch is the right default outside the fleet.
  const repo = mkRepoOnBranch('feat/x', NON_FLEET_ORIGIN)
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['land it']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('git push of a feature branch in a FLEET repo — reminder fires', async () => {
  const repo = mkRepoOnBranch('feat/x', FLEET_ORIGIN)
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git push -u origin feat/x' },
    cwd: repo,
    transcript_path: mkTranscript(['land it']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('feature branch in a fleet repo'))
  assert.ok(String(r.stderr).includes('feat/x:'))
})

test('git push feat/x:main (direct to default) — no reminder', async () => {
  // Already the desired direct push to the default branch.
  const repo = mkRepoOnBranch('feat/x', FLEET_ORIGIN)
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git push origin feat/x:main' },
    cwd: repo,
    transcript_path: mkTranscript(['land it']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('gh pr create --base develop (targeted) — no reminder', async () => {
  // A non-default base is a deliberate stacked/targeted PR.
  const repo = mkRepoOnBranch('feat/x', FLEET_ORIGIN)
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --base develop --title "x"' },
    cwd: repo,
    transcript_path: mkTranscript(['land it']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('regex-evasion: literal "git push" inside a grep is not treated as a push', async () => {
  // Parser-based detection: a quoted string is an arg to grep, not a
  // git-push invocation.
  const repo = mkRepoOnBranch('feat/x', FLEET_ORIGIN)
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'grep -r "git push origin main" .' },
    cwd: repo,
    transcript_path: mkTranscript(['search']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})
