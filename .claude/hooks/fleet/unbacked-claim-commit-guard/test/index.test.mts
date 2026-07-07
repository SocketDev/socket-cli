/**
 * @file node --test specs for the unbacked-claim-commit-guard hook. PreToolUse
 *   Bash guard that BLOCKS (exit 2) a git commit/push when the last assistant
 *   turn made a success claim no command this session backs. Backed claim,
 *   non-landing command, or bypass phrase → exit 0. Fail-open on malformed
 *   stdin. Detection is the shared `_shared/unbacked-claims.mts` matcher.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — spawns the hook subprocess and
// pipes a JSON payload on stdin, needing the ChildProcess stream surface.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isLandingCommand } from '../index.mts'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

// ── isLandingCommand (pure) ─────────────────────────────────────

test('isLandingCommand: git commit → true', () => {
  assert.equal(isLandingCommand('git commit -m "x"'), true)
})

test('isLandingCommand: git push → true', () => {
  assert.equal(isLandingCommand('git push origin main'), true)
})

test('isLandingCommand: git -C <path> commit → true', () => {
  assert.equal(isLandingCommand('git -C /r commit -o f -m "x"'), true)
})

test('isLandingCommand: git status → false', () => {
  assert.equal(isLandingCommand('git status'), false)
})

test('isLandingCommand: a non-git command → false', () => {
  assert.equal(isLandingCommand('pnpm test'), false)
})

// ── end-to-end ──────────────────────────────────────────────────

// Build a transcript JSONL: an assistant turn with `claimText`, optionally
// preceded by an assistant tool_use running `backingCmd`. Returns its path.
function transcript(
  claimText: string,
  opts?: { backingCmd?: string; userText?: string },
): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'unbacked-'))
  const p = path.join(dir, 'transcript.jsonl')
  const lines: string[] = []
  if (opts?.userText) {
    lines.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: opts.userText },
      }),
    )
  }
  if (opts?.backingCmd) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: opts.backingCmd } },
          ],
        },
      }),
    )
  }
  lines.push(
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: claimText },
    }),
  )
  writeFileSync(p, lines.join('\n') + '\n')
  return p
}

function runHook(command: string, transcriptPath: string): Promise<number> {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command },
    transcript_path: transcriptPath,
  }
  const spawned = spawn('node', [HOOK], { stdio: ['pipe', 'ignore', 'pipe'] })
  // lib's spawn() REJECTS on non-zero exit; this guard exits 2 by design.
  spawned.catch(() => {})
  const child = spawned.process
  child.stdin?.end(JSON.stringify(payload))
  return new Promise(resolve => {
    child.on('close', (code: number | null) => resolve(code ?? 0))
  })
}

test('BLOCKS (exit 2): git commit after an unbacked "tests pass" claim', async () => {
  const tp = transcript('Done — all tests pass now.')
  assert.equal(await runHook('git commit -o f -m "x"', tp), 2)
})

test('allows (exit 0): claim is BACKED by a test run this session', async () => {
  const tp = transcript('Done — all tests pass now.', {
    backingCmd: 'node_modules/.bin/vitest run test/foo.test.mts',
  })
  assert.equal(await runHook('git commit -o f -m "x"', tp), 0)
})

test('allows (exit 0): bypass phrase present in transcript', async () => {
  const tp = transcript('Done — all tests pass now.', {
    userText: 'Allow unbacked-claim bypass',
  })
  assert.equal(await runHook('git commit -o f -m "x"', tp), 0)
})

test('allows (exit 0): non-landing command (git status) even with an unbacked claim', async () => {
  const tp = transcript('Done — all tests pass now.')
  assert.equal(await runHook('git status', tp), 0)
})

test('allows (exit 0): no claim in the last turn', async () => {
  const tp = transcript('I edited the file; running tests next.')
  assert.equal(await runHook('git commit -o f -m "x"', tp), 0)
})

test('fails open (exit 0) on malformed stdin', async () => {
  const spawned = spawn('node', [HOOK], { stdio: ['pipe', 'ignore', 'pipe'] })
  spawned.catch(() => {})
  const child = spawned.process
  child.stdin?.end('not json{{{')
  const code = await new Promise<number>(resolve => {
    child.on('close', (c: number | null) => resolve(c ?? 0))
  })
  assert.equal(code, 0)
})
