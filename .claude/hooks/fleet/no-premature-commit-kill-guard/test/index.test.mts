// prefer-async-spawn: sync-semantics-required — a node:test spec drives the
// hook subprocess and asserts on its exit + stderr inline; spawnSync (from the
// lib, not node:child_process) is the right fit. encoding is set at runtime so
// stdout/stderr come back as strings.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { invokesPreCommitGit, killsCommitOrVitest } from '../index.mts'

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

function writeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'no-premature-kill-tx-'))
  const file = path.join(dir, 'transcript.jsonl')
  writeFileSync(
    file,
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: userText },
    }) + '\n',
  )
  return file
}

function run(
  command: string,
  opts?: { background?: boolean; transcriptPath?: string },
): { code: number; stderr: string } {
  const r = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command, run_in_background: opts?.background ?? false },
      transcript_path: opts?.transcriptPath,
    }),
  })
  return { code: typeof r.status === 'number' ? r.status : -1, stderr: String(r.stderr ?? '') }
}

// --- pure helpers ---

test('invokesPreCommitGit: git commit / rebase / merge / cherry-pick', () => {
  assert.equal(invokesPreCommitGit('git commit -m "x"'), 'git commit')
  assert.equal(invokesPreCommitGit('git rebase origin/main'), 'git rebase')
  assert.equal(invokesPreCommitGit('git merge feat'), 'git merge')
  assert.equal(invokesPreCommitGit('git cherry-pick abc123'), 'git cherry-pick')
})

test('invokesPreCommitGit: non-pre-commit git is undefined', () => {
  assert.equal(invokesPreCommitGit('git status'), undefined)
  assert.equal(invokesPreCommitGit('git push origin main'), undefined)
  assert.equal(invokesPreCommitGit('node build.mts'), undefined)
})

test('killsCommitOrVitest: pkill/kill of vitest or git commit', () => {
  assert.ok(killsCommitOrVitest('pkill -f vitest'))
  assert.ok(killsCommitOrVitest('pkill -9 -f "vitest/dist/workers"'))
  assert.ok(killsCommitOrVitest("pkill -f 'git commit'"))
  assert.ok(killsCommitOrVitest('killall vitest'))
})

test('killsCommitOrVitest: unrelated kill is undefined', () => {
  assert.equal(killsCommitOrVitest('kill 12345'), undefined)
  assert.equal(killsCommitOrVitest('pkill -f my-dev-server'), undefined)
  assert.equal(killsCommitOrVitest('git status'), undefined)
})

// --- end-to-end (spawned hook) ---

test('blocks backgrounding a git commit', () => {
  const { code, stderr } = run('git commit -m "wip"', { background: true })
  assert.equal(code, 2)
  assert.match(stderr, /no-premature-commit-kill-guard/)
  assert.match(stderr, /FOREGROUND/)
})

test('blocks backgrounding a git rebase', () => {
  const { code } = run('git rebase origin/main', { background: true })
  assert.equal(code, 2)
})

test('allows a FOREGROUND git commit', () => {
  const { code } = run('git commit -m "wip"', { background: false })
  assert.equal(code, 0)
})

test('allows backgrounding a non-git command (dev server)', () => {
  const { code } = run('node dev-server.mts', { background: true })
  assert.equal(code, 0)
})

test('blocks pkill of vitest', () => {
  const { code, stderr } = run('pkill -f vitest')
  assert.equal(code, 2)
  assert.match(stderr, /corrupts the index/)
})

test('blocks pkill of a git commit', () => {
  const { code } = run("pkill -f 'git commit'")
  assert.equal(code, 2)
})

test('allows kill of an unrelated pid', () => {
  const { code } = run('kill 4242')
  assert.equal(code, 0)
})

test('bypass phrase allows backgrounding the git commit', () => {
  const { code } = run('git commit -m "long migration"', {
    background: true,
    transcriptPath: writeTranscript('Allow background-git bypass'),
  })
  assert.equal(code, 0)
})

test('non-Bash tool passes through', () => {
  const r = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'foo.ts' },
    }),
  })
  assert.equal(r.status, 0)
})

test('malformed payload fails open', () => {
  const r = spawnSync('node', [HOOK], { encoding: 'utf8', input: 'not-json' })
  assert.equal(r.status, 0)
})
