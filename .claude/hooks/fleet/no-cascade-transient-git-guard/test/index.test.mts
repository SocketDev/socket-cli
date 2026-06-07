// node --test specs for the no-cascade-transient-git-guard hook.
//
// The hook blocks a cascade-shaped `git commit` (`-m`/`--message` value
// starting with `chore(wheelhouse): cascade template@`) when the target repo
// is in a transient git state: missing `.git`, detached HEAD, or an
// in-progress rebase / merge / cherry-pick (marker file under `.git/`). It
// shells out to real `git` against the dir resolved from `git -C <dir>`, so
// the FIRES / DOES-NOT-FIRE cases build real repos in a tmp dir and point the
// commit at them via `-C`.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn, spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const CASCADE_MSG = 'chore(wheelhouse): cascade template@deadbeef'

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

async function runHookRaw(stdin: string): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(stdin)
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

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cascade-transient-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

// Track repos to clean up after the run.
const repoDirs: string[] = []

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

function git(cwd: string, args: string[]): void {
  spawnSync('git', args, { cwd, env: GIT_ENV })
}

// A real repo with one commit, sitting on its branch tip (the clean case).
function makeCleanRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cascade-clean-repo-'))
  repoDirs.push(dir)
  git(dir, ['init', '-q'])
  writeFileSync(path.join(dir, 'file.txt'), 'hello\n')
  git(dir, ['add', 'file.txt'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

// A repo on a detached HEAD — `git symbolic-ref HEAD` exits non-zero.
function makeDetachedRepo(): string {
  const dir = makeCleanRepo()
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir })
  const sha = String(head.stdout).trim()
  git(dir, ['checkout', '-q', sha])
  return dir
}

// A clean-tip repo with a transient marker dropped under `.git/` (simulating
// an in-progress rebase / merge / cherry-pick).
function makeRepoWithMarker(marker: string): string {
  const dir = makeCleanRepo()
  const target = path.join(dir, '.git', marker)
  if (marker === 'rebase-apply' || marker === 'rebase-merge') {
    mkdirSync(target, { recursive: true })
  } else {
    writeFileSync(target, 'transient\n')
  }
  return dir
}

test.after(() => {
  for (const dir of repoDirs) {
    rmSync(dir, { force: true, recursive: true })
  }
})

// --- FIRES: each distinct transient shape blocks (exit 2) -------------------

test('blocks cascade commit when .git is missing (no repo)', async () => {
  // A dir that does not exist → existsSync('.git') is false → transient.
  const ghost = path.join(tmpdir(), 'cascade-no-such-repo-zzz-9999')
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${ghost} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-cascade-transient-git-guard/)
})

test('blocks cascade commit on a detached HEAD', async () => {
  const dir = makeDetachedRepo()
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /transient git ref/)
})

test('blocks cascade commit mid cherry-pick (CHERRY_PICK_HEAD marker)', async () => {
  const dir = makeRepoWithMarker('CHERRY_PICK_HEAD')
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks cascade commit mid merge (MERGE_HEAD marker)', async () => {
  const dir = makeRepoWithMarker('MERGE_HEAD')
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks cascade commit mid rebase (rebase-merge marker dir)', async () => {
  const dir = makeRepoWithMarker('rebase-merge')
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks cascade commit via --message= form on a transient ref', async () => {
  const dir = makeDetachedRepo()
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit --message="${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
})

// --- DOES NOT FIRE: cascade commit on a clean branch tip --------------------

test('allows cascade commit on a clean branch tip', async () => {
  const dir = makeCleanRepo()
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// --- PASS-THROUGH: out-of-scope inputs the hook must ignore -----------------

test('passes through a non-cascade commit message even on a transient ref', async () => {
  // Detached HEAD, but the message is NOT a cascade — the hook never looks at
  // the repo state.
  const dir = makeDetachedRepo()
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} commit -m "fix: a normal commit"` },
  })
  assert.strictEqual(result.code, 0)
})

test('passes through a non-commit git command (cascade text in a log grep)', async () => {
  const dir = makeDetachedRepo()
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: `git -C ${dir} log --grep "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 0)
})

test('passes through a non-Bash tool (Edit)', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/tmp/whatever.mts',
      new_string: `git commit -m "${CASCADE_MSG}"`,
    },
  })
  assert.strictEqual(result.code, 0)
})

test('passes through a Bash call with no command field', async () => {
  const result = await runHook({ tool_name: 'Bash', tool_input: {} })
  assert.strictEqual(result.code, 0)
})

// --- NO BYPASS: the canonical "Allow ... bypass" phrase does NOT unblock -----

test('no bypass: a transcript bypass phrase still blocks the transient commit', async () => {
  const dir = makeDetachedRepo()
  const transcript = makeTranscript('Allow no-cascade-transient-git bypass')
  const result = await runHook({
    tool_name: 'Bash',
    transcript_path: transcript,
    tool_input: { command: `git -C ${dir} commit -m "${CASCADE_MSG}"` },
  })
  assert.strictEqual(result.code, 2)
})

// --- MALFORMED PAYLOAD: fail open (exit 0, no crash) ------------------------

test('fails open on garbage (non-JSON) stdin', async () => {
  const result = await runHookRaw('this is not json {{{')
  assert.strictEqual(result.code, 0)
})

test('fails open on empty stdin', async () => {
  const result = await runHookRaw('')
  assert.strictEqual(result.code, 0)
})
