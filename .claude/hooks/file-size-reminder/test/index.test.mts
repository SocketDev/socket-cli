// @ts-expect-error - node:test types via @types/node@catalog work at runtime
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface ToolUseEvent {
  readonly name: string
  readonly input: Record<string, unknown>
}

function makeTranscript(
  dir: string,
  toolUses: readonly ToolUseEvent[],
): string {
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify({ role: 'user', content: 'hi' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'doing the thing' },
          ...toolUses.map(tu => ({
            type: 'tool_use',
            name: tu.name,
            input: tu.input,
          })),
        ],
      },
    }),
  ].join('\n')
  writeFileSync(transcriptPath, lines)
  return transcriptPath
}

function writeLines(filePath: string, n: number): void {
  const content = Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
  writeFileSync(filePath, content)
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('flags soft-cap violation (501-1000 lines)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const target = path.join(dir, 'big.mts')
    writeLines(target, 750)
    const transcript = makeTranscript(dir, [
      { name: 'Edit', input: { file_path: target, new_string: 'x' } },
    ])
    const { stderr, exitCode } = runHook(transcript)
    assert.equal(exitCode, 0)
    assert.match(stderr, /file-size-reminder/)
    assert.match(stderr, /soft cap/)
    assert.match(stderr, /750 lines/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flags hard-cap violation (>1000 lines)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const target = path.join(dir, 'huge.mts')
    writeLines(target, 1500)
    const transcript = makeTranscript(dir, [
      { name: 'Write', input: { file_path: target, content: '...' } },
    ])
    const { stderr } = runHook(transcript)
    assert.match(stderr, /HARD CAP/)
    assert.match(stderr, /1500 lines/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('does not flag files at or under soft cap', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const target = path.join(dir, 'small.mts')
    writeLines(target, 500)
    const transcript = makeTranscript(dir, [
      { name: 'Edit', input: { file_path: target, new_string: 'x' } },
    ])
    const { stderr, exitCode } = runHook(transcript)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skips node_modules paths', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const realDir = path.join(dir, 'node_modules', 'pkg')
    mkdirSync(realDir, { recursive: true })
    const realTarget = path.join(realDir, 'big.mts')
    writeLines(realTarget, 2000)
    const transcript = makeTranscript(dir, [
      { name: 'Edit', input: { file_path: realTarget, new_string: 'x' } },
    ])
    const { stderr, exitCode } = runHook(transcript)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skips Read / Glob tool uses', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const target = path.join(dir, 'big.mts')
    writeLines(target, 2000)
    const transcript = makeTranscript(dir, [
      { name: 'Read', input: { file_path: target } },
      { name: 'Glob', input: { pattern: '**/*.mts' } },
    ])
    const { stderr, exitCode } = runHook(transcript)
    assert.equal(exitCode, 0)
    // Read/Glob don't write, so no flag even though file is over cap
    assert.equal(stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('handles missing file gracefully (no crash)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const transcript = makeTranscript(dir, [
      { name: 'Edit', input: { file_path: '/tmp/does-not-exist-xyz.mts', new_string: 'x' } },
    ])
    const { stderr, exitCode } = runHook(transcript)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deduplicates multiple edits to the same file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const target = path.join(dir, 'multi.mts')
    writeLines(target, 600)
    const transcript = makeTranscript(dir, [
      { name: 'Edit', input: { file_path: target, new_string: 'a' } },
      { name: 'Edit', input: { file_path: target, new_string: 'b' } },
      { name: 'Edit', input: { file_path: target, new_string: 'c' } },
    ])
    const { stderr } = runHook(transcript)
    // Only one warning for the file, not three.
    const matches = stderr.match(/600 lines/g) ?? []
    assert.equal(matches.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('disabled env var short-circuits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsize-'))
  try {
    const target = path.join(dir, 'big.mts')
    writeLines(target, 1500)
    const transcript = makeTranscript(dir, [
      { name: 'Write', input: { file_path: target, content: '...' } },
    ])
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: transcript }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_FILE_SIZE_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
