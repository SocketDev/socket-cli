// node --test specs for the no-non-fleet-push-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns the hook
// subprocess and pipes stdin/stdout/stderr.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

// Make a throwaway git repo with the given origin URL, return its path.
function gitRepoWithOrigin(originUrl: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nfp-guard-'))
  const run = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  run('init', '-q')
  run('remote', 'add', 'origin', originUrl)
  return dir
}

// A dir that is NOT a git repo (no origin) — for the fail-open case.
function nonGitDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'nfp-nongit-'))
}

async function runHook(
  payload: Record<string, unknown>,
  cwd?: string,
): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { cwd, stdio: 'pipe' })
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

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } })

test('non-Bash tool passes', async () => {
  const r = await runHook({ tool_name: 'Edit', tool_input: { command: 'x' } })
  assert.strictEqual(r.code, 0)
})

test('Bash without git push passes', async () => {
  const r = await runHook(bash('ls -la && echo hi'))
  assert.strictEqual(r.code, 0)
})

test('fleet repo via cwd — git push allowed', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/socket-cli.git')
  const r = await runHook(bash('git push origin main'), dir)
  assert.strictEqual(r.code, 0)
})

test('non-fleet repo via cwd — git push BLOCKED', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  const r = await runHook(bash('git push origin main'), dir)
  assert.strictEqual(r.code, 2)
  assert.ok(r.stderr.includes('depot'))
})

test('non-fleet repo via leading cd — BLOCKED', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  // cwd is a fleet repo; the cd redirects git into the non-fleet one.
  const fleetCwd = gitRepoWithOrigin('git@github.com:SocketDev/socket-lib.git')
  const r = await runHook(bash(`cd ${dir} && git push origin main`), fleetCwd)
  assert.strictEqual(r.code, 2)
  assert.ok(r.stderr.includes('depot'))
})

test('non-fleet repo via git -C — BLOCKED', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  const fleetCwd = gitRepoWithOrigin('git@github.com:SocketDev/socket-lib.git')
  const r = await runHook(bash(`git -C ${dir} push origin main`), fleetCwd)
  assert.strictEqual(r.code, 2)
  assert.ok(r.stderr.includes('depot'))
})

test('ultrathink (fleet member, not in cascade roster) — allowed', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/ultrathink.git')
  const r = await runHook(bash('git push'), dir)
  assert.strictEqual(r.code, 0)
})

test('HTTPS remote, non-fleet — BLOCKED', async () => {
  const dir = gitRepoWithOrigin('https://github.com/SocketDev/depot.git')
  const r = await runHook(bash('git push origin main'), dir)
  assert.strictEqual(r.code, 2)
})

test('fork under another owner of a fleet name — allowed (slug matches)', async () => {
  // slug is keyed on repo name; a socket-cli fork still resolves to a
  // fleet slug. (Owner-level gating is out of scope; the name is the key.)
  const dir = gitRepoWithOrigin('git@github.com:someuser/socket-cli.git')
  const r = await runHook(bash('git push'), dir)
  assert.strictEqual(r.code, 0)
})

test('git push mentioned only in a quoted commit message — not a push', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  const r = await runHook(
    bash(`git commit -m "remember to git push later"`),
    dir,
  )
  assert.strictEqual(r.code, 0)
})

test('non-git dir (no origin) — fail open, allowed', async () => {
  const dir = nonGitDir()
  const r = await runHook(bash('git push'), dir)
  assert.strictEqual(r.code, 0)
})

test('substitution: git $(printf push) to a non-fleet repo — BLOCKED', async () => {
  // The shell parser surfaces `git push` even when the subcommand is
  // produced by a $(…) substitution — a form the old regex missed.
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  const r = await runHook(bash('git push $(echo origin) main'), dir)
  assert.strictEqual(r.code, 2)
  assert.ok(r.stderr.includes('depot'))
})

test('pipe/chain push to non-fleet repo — BLOCKED', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  const fleetCwd = gitRepoWithOrigin('git@github.com:SocketDev/socket-lib.git')
  const r = await runHook(
    bash(`echo start && cd ${dir} && git push origin main`),
    fleetCwd,
  )
  assert.strictEqual(r.code, 2)
})

test('bypass phrase in transcript — non-fleet push allowed', async () => {
  const dir = gitRepoWithOrigin('git@github.com:SocketDev/depot.git')
  const txDir = mkdtempSync(path.join(os.tmpdir(), 'nfp-tx-'))
  const transcriptPath = path.join(txDir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow non-fleet-push bypass' },
    }) + '\n',
  )
  const r = await runHook(
    {
      ...bash('git push origin main'),
      transcript_path: transcriptPath,
    },
    dir,
  )
  assert.strictEqual(r.code, 0)
})
