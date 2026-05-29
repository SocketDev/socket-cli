/**
 * @file Smoke test for path-regex-normalize-reminder. Stop hook that warns when
 *   the assistant's recent output writes dual- separator regexes like `[/\\]`
 *   against a path — the fleet helper `normalizePath` already gives one `/`
 *   representation across platforms. Smoke contract: hook loads + dispatches
 *   without throwing; empty transcript path → exit 0.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

async function runHook(payload: unknown): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1 }))
    child.stdin.end(JSON.stringify(payload))
  })
}

test('empty transcript exits 0', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'path-regex-reminder-test-'))
  const transcript = path.join(dir, 'session.jsonl')
  writeFileSync(transcript, '')
  const result = await runHook({ transcript_path: transcript })
  assert.equal(result.code, 0)
})
