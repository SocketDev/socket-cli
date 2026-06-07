// node --test specs for the test-platform-coverage-reminder hook.
//
// The hook is a PreToolUse Edit/Write reminder (via withEditGuard). It never
// blocks (exit stays 0); it writes a stderr nudge when a TEST FILE asserts a
// platform-divergent path token (bin/python3, python.exe, *.exe, C:\…,
// \\Program Files…, /usr/local/bin/python3, …) without a platform gate
// (process.platform / WIN32 / os.platform() / *.skipIf / describeWindows / …).
// There is no bypass phrase — the env-var mentioned in the source comment is
// not read by the code (env kill-switches are fleet-banned), so the only way
// the action passes is a clean shape or a platform gate in the same content.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'test-platform-coverage-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const TEST_FILE = '/Users/x/projects/socket-foo/test/python-download.test.mts'

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

// Spawn the hook with arbitrary raw bytes on stdin (not JSON-serialized) to
// exercise the malformed-payload fail-open path.
async function runHookRaw(raw: string): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(raw)
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

const NUDGE = /test-platform-coverage-reminder/

// ── FIRES: one per distinct divergent-token shape ────────────────────────────

test('fires on bin/python3 assertion in a test file (Write)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(result.path).toBe("/custom/py/python/bin/python3")\n',
    },
  })
  // Reminder never blocks — exit stays 0, but the nudge lands on stderr.
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on bin/python (no version digit) — python3? makes the 3 optional', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("/opt/py/bin/python")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on python.exe assertion (Edit new_string)', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: TEST_FILE,
      new_string: 'expect(p).toBe("C:/py/python.exe")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on node.exe assertion', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("dist/node.exe")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on a generic <word>.exe suffix', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(bin).toBe("build/socket.exe")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on a Windows drive-letter path (C:\\\\)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      // JS string -> content contains  C:\\Users\\me  (two literal backslashes).
      content: 'expect(p).toBe("C:\\\\Users\\\\me")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on a \\\\Program Files UNC-style segment', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("\\\\Program Files\\\\Python\\\\python.exe")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires on a POSIX /usr/local/bin/python3 absolute path', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("/usr/local/bin/python3")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires for a .spec. test file (TEST_FILE_RE matches spec too)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/projects/socket-foo/test/py.spec.ts',
      content: 'expect(p).toBe("/x/bin/python3")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires for a MultiEdit on a test file (withEditGuard accepts MultiEdit)', async () => {
  const result = await runHook({
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: TEST_FILE,
      new_string: 'expect(p).toBe("dist/python.exe")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

// ── DOES NOT FIRE: clean / valid test content ────────────────────────────────

test('stays silent on a clean test file with no divergent token', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: "expect(result.version).toBe('3.12.0')\n",
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('stays silent on bin/node (deliberately excluded — not python/.exe)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("node_modules/.bin/node")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// ── EXEMPTION: platform-gated content stays silent ───────────────────────────

test('stays silent when content branches on process.platform', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content:
        'const expected = process.platform === "win32" ? "py\\\\python.exe" : "py/bin/python3"\nexpect(p).toBe(expected)\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('stays silent when content uses describe.skipIf gate', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content:
        "describe.skipIf(process.platform === 'win32')('posix', () => {\n  expect(p).toBe('/usr/local/bin/python3')\n})\n",
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('stays silent when content uses an isWindows guard', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: TEST_FILE,
      content: 'const want = isWindows ? "python.exe" : "bin/python3"\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// ── PASS THROUGH: out-of-scope tool / path the hook must ignore ──────────────

test('passes through a non-Edit/Write tool (Bash)', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo python.exe in test/foo.test.mts' },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('passes through a non-test path even with a divergent token', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      // No test/ tests/ __tests__/ segment — TEST_FILE_RE does not match.
      file_path: '/Users/x/projects/socket-foo/src/python-bin.mts',
      content: 'export const PY = "/usr/local/bin/python3"\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('passes through a .test.mts file NOT under a test dir (filename alone is not enough)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/projects/socket-foo/src/python.test.mts',
      content: 'expect(p).toBe("/x/bin/python3")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('passes through an Edit with no content (undefined new_string)', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: TEST_FILE },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// ── NO BYPASS PHRASE: a transcript with an "Allow … bypass" line is inert ────
// This hook reads no transcript and has no bypass phrase; a divergent token in
// a test file still nudges even with a bypass-shaped user turn present.

test('no bypass phrase exists — nudge still fires with a transcript present', async () => {
  const transcript = makeTranscript('Allow test-platform-coverage bypass')
  const result = await runHook({
    tool_name: 'Write',
    transcript_path: transcript,
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("/x/bin/python3")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

// ── MALFORMED PAYLOAD: fail open, no crash ───────────────────────────────────

test('fails open on empty stdin (exit 0, no nudge)', async () => {
  const result = await runHookRaw('')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('fails open on garbage (non-JSON) stdin', async () => {
  const result = await runHookRaw('not json at all {{{')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('fails open on a JSON payload missing tool_name', async () => {
  const result = await runHook({
    tool_input: {
      file_path: TEST_FILE,
      content: 'expect(p).toBe("/x/bin/python3")\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})
