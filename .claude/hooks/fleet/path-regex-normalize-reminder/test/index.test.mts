/**
 * @file node --test specs for the path-regex-normalize-reminder hook. Stop hook
 *   that scans the last assistant turn's code fences for dual path-separator
 *   regexes (`[/\\]`, `[\\/]`, `[/]`) — both as `/…/` literals and
 *   `new RegExp("…")` constructors — and nudges the author toward
 *   `normalizePath`. It is a REMINDER: it always exits 0 and signals a finding
 *   by writing a stderr nudge; a clean / out-of-scope / bypassed turn produces
 *   no stderr. Fail-open on malformed stdin.
 */

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

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const NUDGE = /\[path-regex-normalize-reminder]/

type Result = { code: number; stderr: string }

function makeTranscript(...turns: Array<Record<string, unknown>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'path-regex-reminder-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, turns.map(turn => JSON.stringify(turn)).join('\n'))
  return file
}

// A fenced TypeScript code block carrying `body` — the only fence langs the
// hook inspects are the JS/TS family (and the empty tag).
function tsFence(body: string): string {
  return '```ts\n' + body + '\n```'
}

// An assistant turn whose text is exactly `text`.
function assistantTurn(text: string): Record<string, unknown> {
  return { role: 'assistant', content: text }
}

function userTurn(text: string): Record<string, unknown> {
  return { role: 'user', content: text }
}

// A dual-separator regex LITERAL `/[/\\]/` accompanied by a path-flavor token
// (path.join) so the hook's early-out doesn't skip it. `String.raw` keeps the
// backslashes literal in the fence body.
const DUAL_SEP_LITERAL = String.raw`const re = /[/\\]/` + "\nconst p = path.join(dir, 'x')"

// The reversed character-class form `/[\\/]/` plus a path-flavor token.
const DUAL_SEP_LITERAL_REVERSED = String.raw`const re = /[\\/]/` + '\npath.sep'

// `new RegExp("[/\\]")` — the constructor branch. The string value the parser
// reports is `[/\]`, which the dual-separator detector matches.
const DUAL_SEP_CONSTRUCTOR = String.raw`const re = new RegExp("[/\\]")` + '\nprocess.cwd()'

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

test('FIRES: dual-separator regex literal in a ts fence', async () => {
  const transcript = makeTranscript(assistantTurn(tsFence(DUAL_SEP_LITERAL)))
  const result = await runHook({ transcript_path: transcript })
  // Reminder: exit 0 always; the signal is the stderr nudge.
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
  assert.match(result.stderr, /Dual path-separator regex/)
})

test('FIRES: reversed character-class regex literal', async () => {
  const transcript = makeTranscript(
    assistantTurn(tsFence(DUAL_SEP_LITERAL_REVERSED)),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('FIRES: new RegExp(...) constructor with both separators', async () => {
  const transcript = makeTranscript(assistantTurn(tsFence(DUAL_SEP_CONSTRUCTOR)))
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
  assert.match(result.stderr, /new RegExp/)
})

test('FIRES: untagged code fence is still inspected', async () => {
  // The empty lang tag is in CODE_LANGS, so a bare ``` fence counts as code.
  const transcript = makeTranscript(
    assistantTurn('```\n' + DUAL_SEP_LITERAL + '\n```'),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('DOES NOT FIRE: clean single-separator regex after normalizePath', async () => {
  const clean =
    'const norm = normalizePath(input)\n' +
    'const re = /\\/build\\//\n' +
    're.test(norm)'
  const transcript = makeTranscript(assistantTurn(tsFence(clean)))
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('PASS-THROUGH: dual-sep regex with no path-flavor token is ignored', async () => {
  // No path token (path./node_modules/process.cwd/etc.), so the early-out
  // returns before parsing — the regex is presumed to match a URL or similar.
  const transcript = makeTranscript(
    assistantTurn(tsFence(String.raw`const re = /[/\\]/` + '\nmatchUrl(re)')),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('PASS-THROUGH: non-code fence language (md) is skipped', async () => {
  // Markdown / docs fences carry illustrative regexes, not runnable code.
  const transcript = makeTranscript(
    assistantTurn('```md\n' + DUAL_SEP_LITERAL + '\n```'),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('PASS-THROUGH: dual-sep regex in prose with no fence is ignored', async () => {
  // No fenced code block at all → extractCodeFences returns [] → early exit.
  const transcript = makeTranscript(
    assistantTurn('Consider matching path.join output with /[/\\\\]/ here.'),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('PASS-THROUGH: empty transcript exits 0 with no nudge', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'path-regex-reminder-empty-'))
  const transcript = path.join(dir, 'session.jsonl')
  writeFileSync(transcript, '')
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('BYPASS: canonical phrase in a recent user turn suppresses the nudge', async () => {
  const transcript = makeTranscript(
    userTurn('Allow path-regex-normalize bypass'),
    assistantTurn(tsFence(DUAL_SEP_LITERAL)),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('BYPASS: a paraphrase does NOT suppress the nudge', async () => {
  // The bypass is substring-matched on the canonical phrase; a paraphrase
  // ("please allow the path regex thing") must still fire.
  const transcript = makeTranscript(
    userTurn('please allow the path regex normalize thing'),
    assistantTurn(tsFence(DUAL_SEP_LITERAL)),
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('MALFORMED: garbage stdin fails open (exit 0, no crash)', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('}{ not json at all')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, NUDGE)
})

test('MALFORMED: empty stdin fails open (exit 0)', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, NUDGE)
})
