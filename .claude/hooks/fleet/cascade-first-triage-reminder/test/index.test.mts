import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(assistantText: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cascade-triage-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: 'fix the lint' }) +
      '\n' +
      JSON.stringify({ role: 'assistant', content: assistantText }),
  )
  return transcriptPath
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

test('fires when a not-found canonical artifact is patched in the member copy', () => {
  const t = makeTranscript(
    "socket-lib lint failed: Rule 'no-package-manager-auto-update-reenable' " +
      'not found in plugin socket. I edited the cascaded copy in socket-lib ' +
      'to add it.',
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /cascade-first-triage-reminder/)
})

test('stays quiet when the cascade-first path is acknowledged', () => {
  const t = makeTranscript(
    "socket-lib lint failed: Rule 'no-package-manager-auto-update-reenable' " +
      'not found in plugin socket. Checked the wheelhouse — it has the rule, ' +
      'so this is an incomplete cascade; re-cascade socket-lib.',
  )
  const { stderr } = runHook(t)
  assert.doesNotMatch(stderr, /cascade-first-triage-reminder/)
})

test('stays quiet on a not-found that is not a canonical artifact', () => {
  const t = makeTranscript(
    'The test failed: cannot find name foo. I edited socket-lib test to import it.',
  )
  const { stderr } = runHook(t)
  assert.doesNotMatch(stderr, /cascade-first-triage-reminder/)
})

test('stays quiet when no member-patch evidence (just reported the error)', () => {
  const t = makeTranscript(
    "socket-lib lint: Rule 'socket/no-foo' not found in the oxlint-plugin. " +
      'Reporting for triage.',
  )
  const { stderr } = runHook(t)
  assert.doesNotMatch(stderr, /cascade-first-triage-reminder/)
})
