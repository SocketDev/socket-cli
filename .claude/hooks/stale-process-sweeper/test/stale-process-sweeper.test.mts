import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

// Run the hook with an empty stdin payload (Stop hook delivers JSON,
// but the body is unused). Captures stderr + exit code.
function runHook(): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    // Stop hooks receive a JSON payload on stdin. Send an empty object
    // so the hook's drain logic completes.
    child.stdin.end('{}\n')
  })
}

test('stale-process-sweeper: exits 0 when nothing to sweep', async () => {
  const { code, stderr } = await runHook()
  assert.equal(code, 0, `hook should exit 0; stderr=${stderr}`)
  // On a clean host the hook should be silent.
  assert.equal(
    stderr,
    '',
    `hook should be silent when no orphans exist; got: ${stderr}`,
  )
})

test('stale-process-sweeper: ignores live-parent test workers', async () => {
  // Spawn a fake "vitest worker" whose parent is still alive. The
  // sweeper must not touch it. We use a script path that matches the
  // worker regex; the actual command runs `node -e 'setTimeout(...)'`
  // long enough to outlive the hook invocation.
  //
  // Note: matching the regex `vitest/dist/workers/forks` requires a
  // command line that contains that substring. We can't easily forge
  // a real vitest binary, so we approximate by passing the path as an
  // argv string — `ps -o command=` reflects argv, and the regex sees
  // it.
  const fakeWorker = spawn(
    process.execPath,
    [
      '-e',
      'setTimeout(() => {}, 5000)',
      // This dummy arg is what `ps` will report; the sweeper's regex
      // picks it up. The worker still has a live parent (this test
      // process), so the sweeper should NOT kill it.
      '/fake/vitest/dist/workers/forks.js',
    ],
    { stdio: 'ignore', detached: false },
  )
  // Give the OS a moment to register the child.
  await new Promise(r => setTimeout(r, 100))
  try {
    const { code, stderr } = await runHook()
    assert.equal(code, 0)
    // Should NOT have reaped the fake worker — its parent (us) is
    // alive. If the hook killed it, the message would mention it.
    assert.ok(
      !stderr.includes('reaped'),
      `hook reaped a live-parent worker: ${stderr}`,
    )
    // Verify the worker is still alive.
    assert.ok(
      !fakeWorker.killed && fakeWorker.exitCode === null,
      'fake worker should still be running',
    )
  } finally {
    fakeWorker.kill('SIGKILL')
  }
})
