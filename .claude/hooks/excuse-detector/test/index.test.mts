// node --test specs for the excuse-detector hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// writes a fake transcript to a temp dir, passes its path on stdin,
// captures stderr + exit code.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  readonly code: number
  readonly stderr: string
}

interface TranscriptEntry {
  readonly type: 'user' | 'assistant'
  readonly content: string
}

async function runHook(entries: TranscriptEntry[]): Promise<Result> {
  const dir = mkdtempSync(path.join(tmpdir(), 'excuse-detector-test-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines = entries.map(e =>
    JSON.stringify({ type: e.type, message: { content: e.content } }),
  )
  writeFileSync(transcriptPath, lines.join('\n') + '\n')
  try {
    const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    child.stdin.end(JSON.stringify({ transcript_path: transcriptPath }))
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    return await new Promise<Result>(resolve => {
      child.on('exit', code => {
        resolve({ code: code ?? 0, stderr })
      })
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('no transcript path: exits clean', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end(JSON.stringify({}))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('clean assistant turn: no warning', async () => {
  const result = await runHook([
    { type: 'user', content: 'do the work' },
    {
      type: 'assistant',
      content: 'Done. Tests pass and the diff is committed.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('detects "pre-existing"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'The lint error is pre-existing so I skipped it.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /pre-existing/)
  assert.match(result.stderr, /excuse-detector/)
})

test('detects "preexisting" (no hyphen)', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'These are preexisting failures, leaving them.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /pre-existing/)
})

test('detects "not related to my rename"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'Pre-existing test bugs from the null→undefined autofix (not related to my rename).',
    },
  ])
  assert.strictEqual(result.code, 0)
  // Should hit BOTH patterns
  assert.match(result.stderr, /pre-existing/)
  assert.match(result.stderr, /related to my/)
})

test('detects "unrelated to the task"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'This typo is unrelated to the task, skipping.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /unrelated to the task/)
})

test('detects "out of scope"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'Refactoring that module is out of scope here.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /out of scope/)
})

test('detects "separate concern"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'That is a separate concern.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /separate concern/)
})

test('detects "leave it for later"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: "I'll leave it for later.",
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /leave it for later/)
})

test('detects "not my issue"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'The CI failure is not my issue.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /not my issue/)
})

test('scans only the LAST assistant turn', async () => {
  const result = await runHook([
    { type: 'user', content: 'first' },
    {
      type: 'assistant',
      content: 'I noticed a pre-existing bug and fixed it.',
    },
    { type: 'user', content: 'next' },
    { type: 'assistant', content: 'Tests pass, diff is clean.' },
  ])
  // The first assistant turn mentions "pre-existing" but the LAST one
  // is clean — the hook should not warn.
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('respects SOCKET_EXCUSE_DETECTOR_DISABLED', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'excuse-detector-test-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'assistant',
      message: { content: 'this is pre-existing.' },
    }) + '\n',
  )
  try {
    const child = spawn(process.execPath, [HOOK], {
      stdio: 'pipe',
      env: { ...process.env, SOCKET_EXCUSE_DETECTOR_DISABLED: '1' },
    })
    child.stdin.end(JSON.stringify({ transcript_path: transcriptPath }))
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    const result = await new Promise<Result>(resolve => {
      child.on('exit', code => {
        resolve({ code: code ?? 0, stderr })
      })
    })
    assert.strictEqual(result.code, 0)
    assert.strictEqual(result.stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('handles array-of-blocks content shape', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'excuse-detector-test-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'first block' },
          {
            type: 'text',
            text: 'second block has a pre-existing reference',
          },
        ],
      },
    }) + '\n',
  )
  try {
    const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    child.stdin.end(JSON.stringify({ transcript_path: transcriptPath }))
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    const result = await new Promise<Result>(resolve => {
      child.on('exit', code => {
        resolve({ code: code ?? 0, stderr })
      })
    })
    assert.strictEqual(result.code, 0)
    assert.match(result.stderr, /pre-existing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fails open on malformed payload', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('not valid json')
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.strictEqual(result.code, 0)
})
