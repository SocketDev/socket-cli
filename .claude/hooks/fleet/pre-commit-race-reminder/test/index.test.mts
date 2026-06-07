// node --test specs for the pre-commit-race-reminder hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pre-commit-race-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const NUDGE_RE = /pre-commit-race-reminder/

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

// Like runHook but writes raw (possibly non-JSON) bytes to stdin so the
// fail-open path can be exercised.
async function runHookRaw(raw: string): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(raw)
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

// FIRES — plain `git commit --no-verify`.
test('fires on git commit --no-verify', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit --no-verify -m "wip"' },
  })
  // Reminder semantics: exit 0, non-empty stderr nudge.
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE_RE)
})

// FIRES — short `-n` form of --no-verify.
test('fires on git commit -n short flag', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -n -m "wip"' },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE_RE)
})

// FIRES — `--no-verify` after `git -c <key=val> commit` (the isGitCommit
// regex tolerates leading `-c` global flags before the `commit` verb).
test('fires on git -c ... commit --no-verify', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git -c core.hooksPath=/dev/null commit --no-verify -m "x"',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE_RE)
})

// FIRES — `--no-verify=true` long-flag-with-value form (invocationHasFlag
// matches the `--flag=value` shape against the bare flag).
test('fires on git commit --no-verify=true', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit --no-verify=true -m "x"' },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE_RE)
})

// DOES NOT FIRE — a clean git commit without the no-verify flag.
test('does not fire on a plain git commit (no --no-verify)', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "real commit"' },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// PASS-THROUGH (out of scope) — `git config commit.gpgsign` is not a commit
// invocation; the lookahead in isGitCommit must not match `commit.gpgsign`.
test('does not fire on git config commit.gpgsign --no-verify-noise', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git config commit.gpgsign true # --no-verify',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// PASS-THROUGH — a non-commit git subcommand that carries -n (e.g. push) is
// not a commit, so the hook stays silent even though -n is present.
test('does not fire on git push -n (not a commit)', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git push -n origin main' },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// PASS-THROUGH — wrong tool. A non-Bash tool call must be ignored even when
// its payload text mentions `git commit --no-verify`.
test('passes through non-Bash tool calls', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/notes.txt',
      content: 'git commit --no-verify -m "x"',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// EXEMPT — FLEET_SYNC=1 cascade commits legitimately use --no-verify.
test('exempts FLEET_SYNC=1 cascade commits', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command:
        'FLEET_SYNC=1 git commit --no-verify -m "chore(wheelhouse): cascade template@abc123"',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// NOTE — this reminder has NO transcript bypass phrase. `--no-verify` is gated
// upstream by no-revert-guard's `Allow no-verify bypass`; this hook fires
// regardless of that phrase to steer the recovery. Confirm the nudge still
// fires even with the phrase present in the transcript.
test('still fires even when "Allow no-verify bypass" is in transcript', async () => {
  const transcript = makeTranscript('Allow no-verify bypass')
  const result = await runHook({
    tool_name: 'Bash',
    transcript_path: transcript,
    tool_input: { command: 'git commit --no-verify -m "wip"' },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE_RE)
})

// MALFORMED — garbage (non-JSON) stdin must fail open: exit 0, no crash,
// no nudge.
test('fails open on malformed (non-JSON) stdin', async () => {
  const result = await runHookRaw('not json at all {{{')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// MALFORMED — empty stdin must fail open the same way.
test('fails open on empty stdin', async () => {
  const result = await runHookRaw('')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})
