// node --test specs for the avoid-cd-reminder hook.
//
// The hook is a PreToolUse reminder scoped to the Bash tool (via
// withBashGuard). It NEVER blocks — it exits 0 and writes a stderr nudge
// when a Bash command contains a bare `cd <path>` that would persist the
// cwd across tool calls. Exemptions: `cd -`, a `(cd ...)` subshell, a
// command ending in `&& pwd` / `; pwd`, and the `cd <path> 2>/dev/null`
// existence-probe shape. There is NO bypass phrase and NO env kill switch,
// so no bypass case exists.

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
  const dir = mkdtempSync(path.join(tmpdir(), 'avoid-cd-reminder-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

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

// Spawn the hook with raw (possibly non-JSON) bytes on stdin to exercise
// the fail-open path.
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

function bash(command: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { tool_name: 'Bash', tool_input: { command }, ...extra }
}

const NUDGE = /\[avoid-cd-reminder\] Bash command contains a bare `cd/

// ---------------------------------------------------------------------------
// FIRES — distinct shapes the hook catches. Reminder => exit 0 + stderr nudge.
// ---------------------------------------------------------------------------

test('fires: bare `cd /abs/path` at start of command', async () => {
  const result = await runHook(bash('cd /abs/path/to/source'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: bare cd chained with && to another command (no pwd)', async () => {
  const result = await runHook(bash('cd /repo && make build'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: cd appearing after a `;` separator mid-command', async () => {
  const result = await runHook(bash('echo hi ; cd /tmp/foo'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: cd after a pipe boundary', async () => {
  const result = await runHook(bash('true | cd /tmp/foo'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: cd with a `&& pwd` that is NOT at the very end', async () => {
  // The pwd-evidence exemption only matches `&& pwd` / `; pwd` at the END
  // of the whole command; trailing work after pwd defeats it.
  const result = await runHook(bash('cd /repo && pwd && make'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: cd inside a `()` that is already CLOSED before the cd', async () => {
  // The subshell exemption needs an UNMATCHED open paren before the cd.
  // Here the paren group closes first, so opens == closes and the bare cd
  // outside it still fires.
  const result = await runHook(bash('(echo hi) && cd /repo'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: cd target redirecting stderr somewhere OTHER than /dev/null', async () => {
  // Only `2>/dev/null` is treated as a probe; a real logfile redirect is
  // a persistent move and must fire.
  const result = await runHook(bash('cd /repo 2>err.log && make'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: cd spread across a line continuation (flattened before match)', async () => {
  const result = await runHook(bash('cd \\\n/abs/path && make'))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

// ---------------------------------------------------------------------------
// DOES NOT FIRE — exemptions. Reminder stays silent: exit 0 + empty stderr.
// ---------------------------------------------------------------------------

test('exempt: `cd -` (intentional return to previous dir)', async () => {
  const result = await runHook(bash('cd -'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('exempt: subshell form `(cd /abs && make)`', async () => {
  const result = await runHook(bash('(cd /abs/path && make)'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('exempt: command ending in `&& pwd` (evidence captured)', async () => {
  const result = await runHook(bash('cd /abs/path && some-command && pwd'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('exempt: command ending in `; pwd` (evidence captured)', async () => {
  const result = await runHook(bash('cd /abs/path ; pwd'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('exempt: `cd <path> 2>/dev/null` existence-probe shape', async () => {
  const result = await runHook(bash('cd /maybe/here 2>/dev/null && ls'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('clean: command with no cd at all', async () => {
  const result = await runHook(bash('ls -la /repo && make build'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('clean: a token merely starting with "cd" is not a cd command', async () => {
  // The regex requires `cd` to be a standalone word (start or after a
  // separator) followed by whitespace + a target; `cdtest` must not match.
  const result = await runHook(bash('cdtest /repo'))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// ---------------------------------------------------------------------------
// PASS-THROUGH — out-of-scope tool / payload the hook must ignore (exit 0).
// ---------------------------------------------------------------------------

test('pass-through: non-Bash tool (Edit) is ignored even if content has cd', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/script.sh',
      new_string: 'cd /repo && make',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('pass-through: Bash tool with no command field', async () => {
  const result = await runHook({ tool_name: 'Bash', tool_input: {} })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('pass-through: Bash tool with empty command string', async () => {
  const result = await runHook(bash(''))
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// ---------------------------------------------------------------------------
// NO BYPASS — the hook has no bypass phrase; a would-be phrase must NOT
// suppress the nudge.
// ---------------------------------------------------------------------------

test('no bypass: a transcript phrase does not suppress the reminder', async () => {
  const transcript = makeTranscript('Allow avoid-cd bypass')
  const result = await runHook(bash('cd /repo && make', { transcript_path: transcript }))
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

// ---------------------------------------------------------------------------
// MALFORMED — fail open on garbage / empty stdin (no crash, exit 0, silent).
// ---------------------------------------------------------------------------

test('malformed: garbage (non-JSON) stdin fails open', async () => {
  const result = await runHookRaw('{not json at all')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('malformed: empty stdin fails open', async () => {
  const result = await runHookRaw('')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})
