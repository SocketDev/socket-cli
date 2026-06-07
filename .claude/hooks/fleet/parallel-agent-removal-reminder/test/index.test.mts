/**
 * @file Unit tests for parallel-agent-removal-reminder hook.
 *
 * Stop hook, always exit 0. Detects files this session Read that have
 * since vanished without this session running a removal verb. Each test
 * builds a real git repo in tmpdir, writes a transcript JSONL with Read
 * entries, optionally adds a Bash removal command, then deletes (or
 * doesn't) the file before invoking the hook.
 */

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, test } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  readonly code: number
  readonly stderr: string
}

function runHook(
  options: {
    cwd?: string | undefined
    transcriptPath?: string | undefined
    env?: Record<string, string> | undefined
  } = {},
): RunResult {
  const payload = { transcript_path: options.transcriptPath }
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      ...(options.cwd ? { CLAUDE_PROJECT_DIR: options.cwd } : {}),
      ...(options.env ?? {}),
    },
  })
  return { code: r.status ?? -1, stderr: String(r.stderr) }
}

interface TranscriptEntry {
  readonly tool: string
  readonly input: Record<string, unknown>
}

function writeTranscript(
  filePath: string,
  entries: readonly TranscriptEntry[],
): void {
  const lines = entries.map(e =>
    JSON.stringify({
      message: {
        content: [{ name: e.tool, input: e.input }],
      },
    }),
  )
  writeFileSync(filePath, `${lines.join('\n')}\n`)
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'par-removal-'))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: tmpDir,
  })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test('exits 0 with no output when no transcript', () => {
  const r = runHook({ cwd: tmpDir })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('exits 0 with no output when read file still exists', () => {
  const filePath = path.join(tmpDir, 'a.ts')
  writeFileSync(filePath, 'export {}')
  const transcript = path.join(tmpDir, 't.jsonl')
  writeTranscript(transcript, [
    { tool: 'Read', input: { file_path: filePath } },
  ])
  const r = runHook({ cwd: tmpDir, transcriptPath: transcript })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('warns when read file vanished and session did NOT remove it', () => {
  const filePath = path.join(tmpDir, 'a.ts')
  writeFileSync(filePath, 'export {}')
  const transcript = path.join(tmpDir, 't.jsonl')
  writeTranscript(transcript, [
    { tool: 'Read', input: { file_path: filePath } },
  ])
  // Simulate a parallel agent deleting it.
  unlinkSync(filePath)
  const r = runHook({ cwd: tmpDir, transcriptPath: transcript })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /a\.ts/)
})

test('suppressed when session explicitly removed the file via rm', () => {
  const filePath = path.join(tmpDir, 'a.ts')
  writeFileSync(filePath, 'export {}')
  const transcript = path.join(tmpDir, 't.jsonl')
  writeTranscript(transcript, [
    { tool: 'Read', input: { file_path: filePath } },
    {
      tool: 'Bash',
      input: { command: `rm ${filePath}` },
    },
  ])
  unlinkSync(filePath)
  const r = runHook({ cwd: tmpDir, transcriptPath: transcript })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('suppressed when session used git rm on the file', () => {
  const filePath = path.join(tmpDir, 'a.ts')
  writeFileSync(filePath, 'export {}')
  const transcript = path.join(tmpDir, 't.jsonl')
  writeTranscript(transcript, [
    { tool: 'Read', input: { file_path: filePath } },
    {
      tool: 'Bash',
      input: { command: `git rm ${filePath}` },
    },
  ])
  unlinkSync(filePath)
  const r = runHook({ cwd: tmpDir, transcriptPath: transcript })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('escalates to LOUD warning when foreign-dirty signal also present', () => {
  const filePath = path.join(tmpDir, 'a.ts')
  writeFileSync(filePath, 'export {}')
  // Commit the file so its removal shows as `D` in porcelain.
  spawnSync('git', ['add', 'a.ts'], { cwd: tmpDir })
  spawnSync('git', ['commit', '-q', '-m', 'init', '--no-gpg-sign'], {
    cwd: tmpDir,
  })
  // Add a foreign-dirty file (untouched by session, recent mtime).
  const foreignPath = path.join(tmpDir, 'foreign.ts')
  writeFileSync(foreignPath, 'export const x = 1')
  const transcript = path.join(tmpDir, 't.jsonl')
  writeTranscript(transcript, [
    { tool: 'Read', input: { file_path: filePath } },
  ])
  unlinkSync(filePath)
  const r = runHook({ cwd: tmpDir, transcriptPath: transcript })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /PARALLEL AGENT SUSPECTED/)
  assert.match(r.stderr, /PAUSE WORK/)
})

test('ignores vanished paths outside CLAUDE_PROJECT_DIR', () => {
  const outsidePath = path.join(os.tmpdir(), 'scratch-vanished.ts')
  const transcript = path.join(tmpDir, 't.jsonl')
  writeTranscript(transcript, [
    { tool: 'Read', input: { file_path: outsidePath } },
  ])
  // outsidePath was never created → vanished, but outside repo.
  const r = runHook({ cwd: tmpDir, transcriptPath: transcript })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})
