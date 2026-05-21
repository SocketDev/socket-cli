// node --test specs for the excuse-detector hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// writes a fake transcript to a temp dir, passes its path on stdin,
// captures stderr + exit code.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
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

// Single source of truth for the tmp transcript location used by every
// test (1 path, 1 reference). `setupTranscript` constructs the dir +
// file once and returns both, along with the cleanup callback.
function setupTranscript(rawContent: string): {
  readonly dir: string
  readonly transcriptPath: string
  readonly cleanup: () => void
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'excuse-detector-test-'))
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
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

// Helper: assert a hit ended up in stdout as a Stop-hook block JSON.
// In blocking mode the hook writes JSON to stdout and nothing to stderr.
function assertBlock(result: Result, pattern: RegExp): void {
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.match(result.stdout, pattern)
  const parsed = JSON.parse(result.stdout) as {
    decision?: string | undefined
    reason?: string | undefined
  }
  assert.strictEqual(parsed.decision, 'block')
  assert.match(parsed.reason ?? '', pattern)
}

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
  assert.strictEqual(result.stdout, '')
})

test('detects "pre-existing"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'The lint error is pre-existing so I skipped it.',
    },
  ])
  assertBlock(result, /pre-existing/)
  assert.match(result.stdout, /excuse-detector/)
})

test('detects "preexisting" (no hyphen)', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'These are preexisting failures, leaving them.',
    },
  ])
  assertBlock(result, /pre-existing/)
})

test('detects "not related to my rename"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        "Pre-existing test bugs from the null→undefined autofix, skipping — not related to my rename, I'll defer them.",
    },
  ])
  // Should hit BOTH patterns (each paired with a deferral verb).
  assertBlock(result, /pre-existing/)
  assert.match(result.stdout, /related to my/)
})

test('detects "unrelated to the task"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'This typo is unrelated to the task, skipping.',
    },
  ])
  assertBlock(result, /unrelated to the task/)
})

test('detects "out of scope"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: "Refactoring that module is out of scope — I'll skip it.",
    },
  ])
  assertBlock(result, /out of scope/)
})

test('detects "separate concern"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: "That's a separate concern, leaving it for the next pass.",
    },
  ])
  assertBlock(result, /separate concern/)
})

test('detects "leave it for later"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: "I'll leave it for later.",
    },
  ])
  assertBlock(result, /leave it for later/)
})

test('detects "not my issue"', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content: 'The CI failure is not my issue.',
    },
  ])
  assertBlock(result, /not my issue/)
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
  // is clean — the hook should not warn or block.
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('stop_hook_active: true falls back to informational stderr (no block)', async () => {
  const result = await runHook(
    [
      {
        type: 'assistant',
        content: 'The lint error is pre-existing so I skipped it.',
      },
    ],
    { stopHookActive: true },
  )
  assert.strictEqual(result.code, 0)
  // No block JSON on stdout — we already gave Claude one chance.
  assert.strictEqual(result.stdout, '')
  // Still surface the warning informationally.
  assert.match(result.stderr, /pre-existing/)
  assert.match(result.stderr, /excuse-detector/)
})

test('does not fire on phrases inside ASCII double quotes (meta-discussion)', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'When Claude says "pre-existing" or "out of scope", the hook now blocks. Implementation done.',
    },
  ])
  // Quoted = referenced, not asserted. No block, no warning.
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('does not fire on phrases inside ASCII single quotes', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        "The phrase 'leave it for later' is one of the patterns. Implementation done.",
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('does not fire on phrases inside smart double quotes', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'The summary mentions “unrelated to the task” as one excuse phrase.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('still fires on phrases asserted in plain prose (not quoted)', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        "I noticed a lint error but it is pre-existing — I won't fix it; the typo is out of scope for this task.",
    },
  ])
  // Two trigger phrases: "pre-existing" paired with "won't fix"
  // (deferral verb in range) and "out of scope" (bare phrase).
  assertBlock(result, /pre-existing/)
  assert.match(result.stdout, /out of scope/)
})

test('does NOT fire on descriptive "out of scope" (no deferral verb)', async () => {
  // Pure description of what the rule docs say — no skip / leave /
  // defer verb in range. Should not fire.
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'The rule documents an out of scope branch for files belonging to another session. Summary done.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('does NOT fire on descriptive "unrelated to the task" (no deferral verb)', async () => {
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'The test fixture appears unrelated to the task on its surface, so I rewrote it to match.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('does NOT fire on descriptive "pre-existing X was fixed"', async () => {
  // The deferral-shape regex requires a deferral verb near
  // "pre-existing" (skip / leave / defer / can't / won't / etc.).
  // Plain descriptive uses where the assistant is reporting work
  // ("pre-existing bugs were fixed", "the pre-existing TS error is
  // now resolved") must not fire — they're describing fixes, not
  // deferring them.
  const result = await runHook([
    {
      type: 'assistant',
      content:
        'Summary: 8 pre-existing test-fixture bugs fixed. The pre-existing RuleTester bug that affected every rule is resolved.',
    },
  ])
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
  assert.strictEqual(result.stdout, '')
})

test('respects SOCKET_EXCUSE_DETECTOR_DISABLED', async () => {
  const transcript = setupTranscript(
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
    child.stdin!.end(
      JSON.stringify({ transcript_path: transcript.transcriptPath }),
    )
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
    assert.strictEqual(result.stderr, '')
    assert.strictEqual(result.stdout, '')
  } finally {
    transcript.cleanup()
  }
})

test('handles array-of-blocks content shape', async () => {
  const transcript = setupTranscript(
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'first block' },
          {
            type: 'text',
            text: 'second block: the lint error is pre-existing so I skipped it',
          },
        ],
      },
    }) + '\n',
  )
  try {
    const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    child.stdin!.end(
      JSON.stringify({ transcript_path: transcript.transcriptPath }),
    )
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
    assertBlock(result, /pre-existing/)
  } finally {
    transcript.cleanup()
  }
})

test('fails open on malformed payload', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin!.end('not valid json')
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
})
