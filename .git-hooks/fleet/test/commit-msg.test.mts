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

async function runHook(
  commitMsg: string,
  env?: Record<string, string>,
): Promise<{
  result: Result
  rewrittenMessage: string
}> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-msg-test-'))
  const msgFile = path.join(dir, 'COMMIT_EDITMSG')
  writeFileSync(msgFile, commitMsg)
  // Run from the repo root (two levels up from this test dir) so the hook's
  // readIdentityPolicy(process.cwd()) finds the cascaded
  // .config/fleet/git-authors.json denylist.
  const repoRoot = path.resolve(here, '..', '..', '..')
  try {
    const child = spawn(process.execPath, [HOOK, msgFile], {
      stdio: 'pipe',
      cwd: repoRoot,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
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

test('commit-msg: BLOCKS a foreign owner/repo#num issue reference', async () => {
  // A real identity (so the author gate stays out of the way) plus a
  // foreign `<owner>/<repo>#<num>` token in the body — the ext-issue-ref
  // scan must block it.
  const { result } = await runHook(
    'fix(scan): handle empty manifest\n\nMatches behavior in spencermountain/compromise#1203.\n',
    {
      GIT_AUTHOR_NAME: 'John-David Dalton',
      GIT_AUTHOR_EMAIL: 'john.david.dalton@gmail.com',
      GIT_COMMITTER_NAME: 'John-David Dalton',
      GIT_COMMITTER_EMAIL: 'john.david.dalton@gmail.com',
    },
  )
  assert.strictEqual(result.code, 1)
  assert.match(result.stderr, /non-SocketDev GitHub issue\/PR/)
  assert.match(result.stderr, /spencermountain\/compromise#1203/)
})

test('commit-msg: ALLOWS a SocketDev-owned owner/repo#num reference', async () => {
  const { result } = await runHook(
    'fix(scan): align with SocketDev/socket-lib#42\n',
    {
      GIT_AUTHOR_NAME: 'John-David Dalton',
      GIT_AUTHOR_EMAIL: 'john.david.dalton@gmail.com',
      GIT_COMMITTER_NAME: 'John-David Dalton',
      GIT_COMMITTER_EMAIL: 'john.david.dalton@gmail.com',
    },
  )
  assert.strictEqual(result.code, 0)
})

test('commit-msg: BLOCKS a placeholder subject "initial"', async () => {
  const { result } = await runHook('initial\n')
  assert.strictEqual(result.code, 1)
  assert.match(result.stderr, /placeholder subject/)
})

test('commit-msg: BLOCKS placeholder subject "wip" (with trailing period)', async () => {
  const { result } = await runHook('wip.\n')
  assert.strictEqual(result.code, 1)
})

test('commit-msg: ALLOWS a real subject that starts with a placeholder word', async () => {
  // `initial` alone is blocked, but `fix(init): …` is a real subject.
  const { result } = await runHook('fix(init): handle empty bootstrap config\n')
  assert.strictEqual(result.code, 0)
})

test('commit-msg: BLOCKS a placeholder author identity (test@example.com)', async () => {
  // git var GIT_AUTHOR_IDENT resolves GIT_AUTHOR_NAME/EMAIL from the env, so
  // forcing them here exercises the identity guard end-to-end against the
  // cascaded .config/fleet/git-authors.json denylist (*@example.com).
  const { result } = await runHook('feat(x): real subject\n', {
    GIT_AUTHOR_NAME: 'Somebody',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Somebody',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  })
  assert.strictEqual(result.code, 1)
  assert.match(result.stderr, /placeholder\/sandbox identity/)
})

test('commit-msg: BLOCKS a placeholder author NAME (Test) with a real email', async () => {
  const { result } = await runHook('feat(x): real subject\n', {
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'dev@socket.dev',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'dev@socket.dev',
  })
  assert.strictEqual(result.code, 1)
  assert.match(result.stderr, /placeholder\/sandbox identity/)
})

test('commit-msg: ALLOWS a real identity (no allowlist configured → only denylist gates)', async () => {
  const { result } = await runHook('feat(x): real subject\n', {
    GIT_AUTHOR_NAME: 'John-David Dalton',
    GIT_AUTHOR_EMAIL: 'john.david.dalton@gmail.com',
    GIT_COMMITTER_NAME: 'John-David Dalton',
    GIT_COMMITTER_EMAIL: 'john.david.dalton@gmail.com',
  })
  assert.strictEqual(result.code, 0)
})
