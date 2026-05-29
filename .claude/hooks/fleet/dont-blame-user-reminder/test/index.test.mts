// node --test specs for the dont-blame-user-reminder hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// writes a fake transcript to a temp dir, passes its path on stdin,
// captures stdout/stderr + exit code. The hook runs in BLOCKING mode:
// on a hit it writes a `{decision:'block'}` JSON to stdout and nothing
// to stderr; stop_hook_active suppresses it.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  readonly code: number
  readonly stderr: string
  readonly stdout: string
}

interface TranscriptEntry {
  readonly type: 'user' | 'assistant'
  readonly content: string
}

interface RunHookOptions {
  readonly stopHookActive?: boolean | undefined
}

function setupTranscript(rawContent: string): {
  readonly dir: string
  readonly transcriptPath: string
  readonly cleanup: () => void
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dont-blame-user-test-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(transcriptPath, rawContent)
  return {
    dir,
    transcriptPath,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function runHook(
  entries: TranscriptEntry[],
  options: RunHookOptions = {},
): Promise<Result> {
  const rawContent =
    entries
      .map(e =>
        JSON.stringify({ type: e.type, message: { content: e.content } }),
      )
      .join('\n') + '\n'
  const transcript = setupTranscript(rawContent)
  try {
    const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    void child.catch(() => undefined)
    const payload: Record<string, unknown> = {
      transcript_path: transcript.transcriptPath,
    }
    if (options.stopHookActive) {
      payload['stop_hook_active'] = true
    }
    child.stdin!.end(JSON.stringify(payload))
    let stderr = ''
    let stdout = ''
    child.process.stderr!.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    child.process.stdout!.on('data', chunk => {
      stdout += chunk.toString('utf8')
    })
    return await new Promise<Result>(resolve => {
      child.process.on('exit', code => {
        resolve({ code: code ?? 0, stderr, stdout })
      })
    })
  } finally {
    transcript.cleanup()
  }
}

// In blocking mode the hook writes a `{decision:'block'}` JSON to
// stdout and nothing to stderr.
function assertBlock(result: Result, pattern: RegExp): void {
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.match(result.stdout, pattern)
  const parsed = JSON.parse(result.stdout) as {
    decision?: string | undefined
    reason?: string | undefined
  }
  assert.strictEqual(parsed.decision, 'block')
}

test('no transcript path: exits clean', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin!.end(JSON.stringify({}))
  let stderr = ''
  let stdout = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  child.process.stdout!.on('data', chunk => {
    stdout += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr, stdout })
    })
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stdout, '')
})

test('clean assistant turn: no block', async () => {
  const result = await runHook([
    { type: 'user', content: 'do the work' },
    {
      type: 'assistant',
      content: 'Investigated the cascade; the strip came from oxfmt. Fixed.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stdout, '')
})

test('blocks "the user reverted my edits"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'It looks like the user reverted my edits between turns.',
    },
  ])
  assertBlock(result, /dont-blame-user-reminder/)
})

test('blocks "the linter stripped" my assertions', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'The linter stripped the non-null assertions I added.',
    },
  ])
  assertBlock(result, /dont-blame-user-reminder/)
})

test('blocks "the formatter rewrote"', async () => {
  const result = await runHook([
    { type: 'assistant', content: 'The formatter rewrote the file again.' },
  ])
  assertBlock(result, /dont-blame-user-reminder/)
})

test('blocks "user\'s preferred state"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: "This must be the user's preferred state with no assertions.",
    },
  ])
  assertBlock(result, /dont-blame-user-reminder/)
})

test('blocks "the user chose to strip"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'Presumably the user chose to strip those checks.',
    },
  ])
  assertBlock(result, /dont-blame-user-reminder/)
})

test('stop_hook_active suppresses the block', async () => {
  const result = await runHook(
    [
      {
        type: 'assistant',
        content: 'The user reverted my edits.',
      },
    ],
    { stopHookActive: true },
  )
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stdout, '')
})

test('quoted span describing the phrase does not self-fire', async () => {
  // The hook strips quoted spans, so describing what it detects (in
  // double quotes) is not itself a blame.
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'The hook fires on phrases like "the user reverted" — I avoided those.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stdout, '')
})
