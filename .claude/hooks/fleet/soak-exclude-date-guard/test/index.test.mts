// Tests for soak-exclude-date-guard.

import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  code: number
  stderr: string
}

function runHook(payload: object): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit; this test reads stderr + exit via manual listeners
    // instead. Swallow the Promise rejection so it doesn't race the
    // listener-based resolve and trigger "async activity after test ended".
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('close', code => {
      resolve({ code: code ?? 0, stderr })
    })
    child.stdin!.write(JSON.stringify(payload))
    child.stdin!.end()
  })
}

const ANNOTATED = `minimumReleaseAgeExclude:
  - '@socketsecurity/*'
  # vite 8.0.13 ships rolldown natively.
  # published: 2026-05-14 | removable: 2026-05-21
  - 'vite@8.0.13'
`

const UNANNOTATED = `minimumReleaseAgeExclude:
  - '@socketsecurity/*'
  # vite 8.0.13 ships rolldown natively.
  - 'vite@8.0.13'
`

const ONLY_GLOBS = `minimumReleaseAgeExclude:
  - '@socketaddon/*'
  - '@socketbin/*'
  - '@socketregistry/*'
  - '@socketsecurity/*'
`

describe('soak-exclude-date-guard', () => {
  test('passes when annotation is present', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/pnpm-workspace.yaml', content: ANNOTATED },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('blocks when annotation is missing on an exact-pin entry', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/tmp/pnpm-workspace.yaml',
        content: UNANNOTATED,
      },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /vite@8\.0\.13/)
    assert.match(result.stderr, /published:/)
    assert.match(result.stderr, /removable:/)
  })

  test('passes for glob-only soak-exclude block', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/tmp/pnpm-workspace.yaml',
        content: ONLY_GLOBS,
      },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores non-pnpm-workspace.yaml files', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/package.json', content: UNANNOTATED },
    })
    assert.equal(result.code, 0)
  })

  test('ignores non-Edit/Write tool calls', async () => {
    const result = await runHook({
      tool_name: 'Read',
      tool_input: {
        file_path: '/tmp/pnpm-workspace.yaml',
        content: UNANNOTATED,
      },
    })
    assert.equal(result.code, 0)
  })

  test('respects per-line allow marker', async () => {
    const content = `minimumReleaseAgeExclude:
  # no annotation here
  - 'pkg@1.0.0' # socket-lint: allow soak-exclude-no-date-annotation
`
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/pnpm-workspace.yaml', content },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('fails open on a malformed payload', async () => {
    const child = spawn('node', [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] })
    let exitCode = 0
    child.process.on('close', code => {
      exitCode = code ?? 0
    })
    child.stdin!.write('not-json')
    child.stdin!.end()
    await new Promise<void>(resolve =>
      child.process.on('close', () => resolve()),
    )
    assert.equal(exitCode, 0)
  })
})
