// node --test specs for .git-hooks/commit-msg.mts.
//
// Smoke tests: spawn the hook with a temp commit-message file and
// inspect the rewritten file + exit code. The hook strips AI
// attribution lines and blocks commits that look like they're
// committing secrets / .env files.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'commit-msg.mts')

type Result = { code: number; stderr: string }

async function runHook(commitMsg: string): Promise<{
  result: Result
  rewrittenMessage: string
}> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-msg-test-'))
  const msgFile = path.join(dir, 'COMMIT_EDITMSG')
  writeFileSync(msgFile, commitMsg)
  try {
    const child = spawn(process.execPath, [HOOK, msgFile], { stdio: 'pipe' })
    // The fleet `spawn` returns `{ process } & Promise<{ code, stderr, … }>`
    // and REJECTS on a non-zero exit (error carries `.code` + `.stderr`).
    // Await it, treating a rejection as the hook's exit result.
    let result: Result
    try {
      const r = await child
      result = {
        code: typeof r.code === 'number' ? r.code : 0,
        stderr: String(r.stderr ?? ''),
      }
    } catch (e) {
      const err = e as { code?: number | undefined; stderr?: unknown }
      result = {
        code: typeof err.code === 'number' ? err.code : 1,
        stderr: String(err.stderr ?? ''),
      }
    }
    const rewrittenMessage = readFileSync(msgFile, 'utf8')
    return { result, rewrittenMessage }
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

test('commit-msg: passes through clean prose', async () => {
  const { result, rewrittenMessage } = await runHook(
    'feat(auth): add OAuth callback handler\n\nWires the redirect URI through the new endpoint.\n',
  )
  assert.strictEqual(result.code, 0)
  assert.match(rewrittenMessage, /feat\(auth\): add OAuth callback handler/)
})

test('commit-msg: strips Co-Authored-By: Claude attribution', async () => {
  const { result, rewrittenMessage } = await runHook(
    'feat: ship feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
  )
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(rewrittenMessage, /Co-Authored-By: Claude/)
  assert.match(rewrittenMessage, /feat: ship feature/)
})

test('commit-msg: strips 🤖 emoji attribution line', async () => {
  const { result, rewrittenMessage } = await runHook(
    'fix: bug\n\n🤖 Generated with Claude Code\n',
  )
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(rewrittenMessage, /🤖/)
})

test('commit-msg: keeps prose mentioning Claude in context', async () => {
  // Bare "Claude Code" reference (not an attribution claim) survives
  // the strip — this was the regression that prompted the regex fix.
  const { result, rewrittenMessage } = await runHook(
    'docs(claude): point at Claude Code best practices\n\nLinks the upstream guide that informs the .claude/ layout.\n',
  )
  assert.strictEqual(result.code, 0)
  assert.match(rewrittenMessage, /Claude Code best practices/)
  assert.match(rewrittenMessage, /\.claude\//)
})
