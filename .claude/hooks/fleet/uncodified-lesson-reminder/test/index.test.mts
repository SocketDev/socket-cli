// node --test specs for the uncodified-lesson-reminder hook.
//
// Stop hook (non-blocking, exit 0). Nudges when the turn WROTE a feedback/project
// memory with an enforceable shape + no enforcer citation. Quiet on: a cited
// memory, a reference/user memory, a non-enforceable lesson, a non-memory write,
// a turn with no memory write. Fails open on a malformed payload. Pure-function
// branches (isMemoryPath / isEnforceableLesson / citesEnforcer) are unit-checked
// directly; the firing/quiet behavior is exercised by spawning the hook over a
// synthesized transcript.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — spawns the hook subprocess.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { citesEnforcer, isEnforceableLesson, isMemoryPath } from '../index.mts'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const MEM =
  '/Users/x/.claude/projects/-Users-x-projects-socket-foo/memory/feedback_thing.md'

// Build a transcript whose most-recent assistant turn issues `toolUses`.
function makeTranscript(toolUses: Array<Record<string, unknown>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'uncodified-lesson-reminder-'))
  const file = path.join(dir, 'session.jsonl')
  const content = toolUses.map(t => ({
    type: 'tool_use',
    name: t['name'],
    input: t['input'],
  }))
  const line = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content },
  })
  writeFileSync(file, line + '\n')
  return file
}

type Result = { code: number; stderr: string }

async function runHook(transcriptPath: string): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify({ transcript_path: transcriptPath }))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
}

const ENFORCEABLE = `---
name: feedback_thing
metadata:
  type: feedback
---
Always do X. Never do Y.`

const CITED = `---
name: feedback_thing
metadata:
  type: feedback
---
Always do X (enforced by \`.claude/hooks/fleet/thing-guard/\`).`

const REFERENCE = `---
name: reference_thing
metadata:
  type: reference
---
See the dashboard at example.com.`

// ---- pure-function unit checks (every branch) ----

test('isMemoryPath matches a memory-store path', () => {
  assert.equal(isMemoryPath(MEM), true)
  assert.equal(isMemoryPath('/Users/x/projects/socket-foo/src/a.mts'), false)
  assert.equal(
    isMemoryPath('/Users/x/.claude/projects/foo/memory/MEMORY.md'),
    true,
  )
})

test('isEnforceableLesson: feedback + imperative → true', () => {
  assert.equal(isEnforceableLesson(ENFORCEABLE), true)
})

test('isEnforceableLesson: reference type → false', () => {
  assert.equal(isEnforceableLesson(REFERENCE), false)
})

test('isEnforceableLesson: feedback with no imperative → false', () => {
  const flat = '---\nmetadata:\n  type: feedback\n---\nA note about the thing.'
  assert.equal(isEnforceableLesson(flat), false)
})

test('citesEnforcer: hook / socket-rule / check path → true; bare prose → false', () => {
  assert.equal(citesEnforcer(CITED), true)
  assert.equal(citesEnforcer('uses `socket/prefer-x`'), true)
  assert.equal(citesEnforcer('see scripts/fleet/check/foo.mts'), true)
  assert.equal(citesEnforcer('just prose, no enforcer'), false)
})

// ---- spawned firing / quiet behavior ----

test('FIRES on an enforceable, uncited memory write', async () => {
  const t = makeTranscript([
    { name: 'Write', input: { file_path: MEM, content: ENFORCEABLE } },
  ])
  const r = await runHook(t)
  assert.equal(r.code, 0)
  assert.match(r.stderr, /uncodified-lesson-reminder/)
  assert.match(r.stderr, /codify-rule\.mts|codifying-disciplines/)
})

test('QUIET when the memory already cites an enforcer', async () => {
  const t = makeTranscript([
    { name: 'Write', input: { file_path: MEM, content: CITED } },
  ])
  const r = await runHook(t)
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('QUIET on a reference-type memory', async () => {
  const t = makeTranscript([
    { name: 'Write', input: { file_path: MEM, content: REFERENCE } },
  ])
  const r = await runHook(t)
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('QUIET on a non-memory file write', async () => {
  const t = makeTranscript([
    {
      name: 'Edit',
      input: {
        file_path: '/Users/x/projects/socket-foo/src/a.mts',
        new_string: 'Always do X',
      },
    },
  ])
  const r = await runHook(t)
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('QUIET on a turn with no tool uses', async () => {
  const t = makeTranscript([])
  const r = await runHook(t)
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('malformed payload fails open (exit 0)', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('not json {{{')
  const code: number = await new Promise(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.equal(code, 0)
})
