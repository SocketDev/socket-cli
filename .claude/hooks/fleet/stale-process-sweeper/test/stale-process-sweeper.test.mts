// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classify, classifyAgent, isSessionCriticalDaemon } from '../index.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

// Build a minimal ProcRow for classify() — only `command` is read by
// the pattern matcher; the rest satisfy the type.
function row(command: string) {
  return { command, elapsedSec: 0, pcpu: 0, pid: 1234, ppid: 1, rss: 0 }
}

// Run the hook with an empty stdin payload (Stop hook delivers JSON,
// but the body is unused). Captures stderr + exit code.
function runHook(): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
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
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    // Stop hooks receive a JSON payload on stdin. Send an empty object
    // so the hook's drain logic completes.
    child.stdin!.end('{}\n')
  })
}

test('stale-process-sweeper: classifies every sfw wrapper layout', () => {
  // Regression: 2026-06-02 the sfw regex only matched `sfw/bin`, so the
  // package-manager shims' real exec target
  // (~/.socket/_wheelhouse/sfw-stable/sfw) went unmatched and leaked 44
  // orphaned probe processes over ~7h. All known layouts must classify
  // as 'sfw-wrapper'.
  const layouts = [
    '/Users/u/.socket/_wheelhouse/sfw-stable/sfw /lib/pnpm run test',
    '/Users/u/.socket/_wheelhouse/bin/sfw-1.7.2 /lib/pnpm install',
    '/Users/u/.socket/sfw/bin/sfw /lib/pnpm list',
    '/Users/u/.socket/sfw/bin/sfw-1.7.2 /lib/pnpm --version',
    '/home/u/.socket/_dlx/a1b2c3d4/sfw /lib/npm ci',
    '/tmp/runner/sfw-bin/sfw.exe /lib/pnpm i',
  ]
  for (const cmd of layouts) {
    assert.equal(classify(row(cmd)), 'sfw-wrapper', `should match: ${cmd}`)
  }
  // Windows-style backslash path: listProcesses() swaps `\` → `/` in the
  // command before classify() sees it, so a `\`-separated sfw path matches
  // once the separators are normalized. Mirror that swap here. A path with
  // embedded spaces ("Program Files") and a `..` in an argument must
  // survive the swap intact — only separators change, not path structure.
  const winCmd = 'C:\\Users\\u\\.socket\\sfw\\bin\\sfw.exe pnpm i ..\\pkg'
  assert.equal(classify(row(winCmd.replaceAll('\\', '/'))), 'sfw-wrapper')
  // Plain pnpm (no sfw wrapper) must NOT classify as an sfw wrapper.
  assert.notEqual(
    classify(row('/Users/u/Library/pnpm/pnpm run test')),
    'sfw-wrapper',
  )
})

test('stale-process-sweeper: classifyAgent matches orphaned agent shapes', () => {
  // Real PPID-1 leaks observed (12–19 days old) that motivated the
  // agent-orphan sweep. classifyAgent only runs under --all + orphan gate.
  const codexBroker =
    '/Users/u/.nvm/versions/node/v26.1.0/bin/node /Users/u/projects/codex-plugin-cc/plugins/codex/scripts/app-server-broker.mjs serve --endpoint unix:/tmp/cxc-x/broker.sock'
  const codexAppServer = 'node /tmp/codex-plugin-test-0oHwcO/codex app-server'
  const claudeDoctor = 'claude doctor'
  const taskPoller =
    'bash -c until [ -f /tmp/claude-501/-Users-u-projects-x/abc/tasks/b2mpybdxn.output.exitcode ]; do sleep 2; done'
  for (const cmd of [codexBroker, codexAppServer, claudeDoctor, taskPoller]) {
    assert.notEqual(classifyAgent(row(cmd)), undefined, `should match: ${cmd}`)
  }
})

test('stale-process-sweeper: classifyAgent does not match innocuous commands', () => {
  // A project path containing "claude", a live editor, a plain node REPL,
  // and the sweeper itself must NEVER classify as a reapable agent.
  const safe = [
    'node /Users/u/projects/claude-something/build.mjs',
    '/Applications/Cursor.app/Contents/MacOS/Cursor',
    'node --test ./src/foo.test.ts',
    'vim app-server-notes.md',
  ]
  for (const cmd of safe) {
    assert.equal(classifyAgent(row(cmd)), undefined, `must NOT match: ${cmd}`)
  }
  // And these are NOT build/test workers either.
  for (const cmd of safe) {
    assert.equal(classify(row(cmd)), undefined, `must NOT match worker: ${cmd}`)
  }
})

test('stale-process-sweeper: never sweeps the token-minifier proxy', () => {
  // The proxy is the live ANTHROPIC_BASE_URL backend; it runs detached
  // (PPID 1) on purpose, so without this guard --all would reap it and
  // break the session running the sweep. isSessionCriticalDaemon wins over every
  // classifier.
  const proxy =
    'node /Users/u/.socket/_wheelhouse/socket-token-minifier/bin/socket-token-minifier.mts'
  assert.equal(isSessionCriticalDaemon(proxy), true)
  // A built .js entry under the same package path is still protected.
  assert.equal(
    isSessionCriticalDaemon('node /opt/socket-token-minifier/dist/proxy.js'),
    true,
  )
  // Unrelated processes are not protected.
  assert.equal(
    isSessionCriticalDaemon('node /Users/u/projects/app/server.mjs'),
    false,
  )
})

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
      !fakeWorker.process.killed && fakeWorker.process.exitCode === null,
      'fake worker should still be running',
    )
  } finally {
    fakeWorker.process.kill('SIGKILL')
  }
})
