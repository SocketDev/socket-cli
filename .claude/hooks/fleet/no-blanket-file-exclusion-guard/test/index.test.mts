// node --test specs for the no-blanket-file-exclusion-guard hook.
//
// PreToolUse(Edit|Write|MultiEdit) guard. Blocks content that introduces a
// `max-file-lines:` marker failing the `<category> — <reason>` contract — a
// self-judgment word (`legitimate`, `ok`, …) as the category, or a category
// with no reason. A real `<category> — <reason>` marker passes through. Only
// the first 5 lines are scanned. The guard has NO bypass phrase and NO env
// kill switch. Fails open on a malformed payload (exit 0).

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
  const dir = mkdtempSync(
    path.join(tmpdir(), 'no-blanket-file-exclusion-guard-'),
  )
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

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

const SRC_FILE = '/Users/x/projects/socket-foo/src/widget.mts'

// FIRES — bare `legitimate` marker (no category).
test('blocks bare legitimate marker', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: '/* max-file-lines: legitimate */\nexport const x = 1\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-blanket-file-exclusion-guard/)
  assert.match(result.stderr, /legitimate/)
})

// FIRES — `legitimate` leads, even with a real category-shaped word after it.
test('blocks legitimate-prefixed marker', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '// max-file-lines: legitimate — one cohesive module\nexport const x = 1\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /legitimate.*not a category/s)
})

// FIRES — a different self-judgment word (`ok`) as the category.
test('blocks ok as a category word', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "/* max-file-lines: ok — it's fine */\nexport const x = 1\n",
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /`ok` is a self-judgment/)
})

// FIRES — `exempt` self-judgment word.
test('blocks exempt as a category word', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: '// max-file-lines: exempt — too big to split\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /`exempt` is a self-judgment/)
})

// FIRES — a real category with NO `— reason` separator.
test('blocks category with no reason', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: '/* max-file-lines: parser */\nexport const x = 1\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Line 1/)
})

// FIRES — and the block message steers to SPLIT and states the marker is
// hard-cap-only (the soft band gets no exemption).
test('block message states hard-cap-only and steers to split', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: '/* max-file-lines: parser */\nexport const x = 1\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /HARD-CAP-ONLY/)
  assert.match(result.stderr, /SPLIT/)
})

// FIRES — Edit tool path (content arrives via `new_string`).
test('blocks via Edit new_string field', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: SRC_FILE,
      new_string: '/* max-file-lines: legitimate */\n',
    },
  })
  assert.strictEqual(result.code, 2)
})

// DOES-NOT-FIRE — a real `<category> — <reason>` marker (em-dash).
test('allows parser — reason marker', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '/* max-file-lines: parser — recursive-descent grammar, one cohesive table */\nexport const x = 1\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// DOES-NOT-FIRE — hyphenated multi-word category.
test('allows integration-test — reason marker', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '// max-file-lines: integration-test — one end-to-end scenario per file\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// DOES-NOT-FIRE — state-machine category with em-dash.
test('allows state-machine — reason marker', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '/* max-file-lines: state-machine — exhaustive transition table */\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// DOES-NOT-FIRE — no `max-file-lines:` marker at all.
test('allows clean content with no marker', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: 'export function add(a: number, b: number) {\n  return a + b\n}\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// DOES-NOT-FIRE — a bad marker buried past line 5 is not a file-level
// exemption, so the guard ignores it (matches the lint rule's window).
test('ignores a bad marker below the first 5 lines', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        'line 1\nline 2\nline 3\nline 4\nline 5\n// max-file-lines: legitimate\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// DOES-NOT-FIRE — the word `legitimate` mid-prose, not in a marker.
test('allows legitimate appearing in non-marker prose', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "const msg = 'this is a legitimate concern'\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

// PASS-THROUGH — non-Edit/Write tool is out of scope.
test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: '/* max-file-lines: legitimate */' },
  })
  assert.strictEqual(result.code, 0)
})

// PASS-THROUGH — Edit/Write payload with no file_path is ignored.
test('Edit payload without file_path passes through', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: { new_string: '/* max-file-lines: legitimate */\n' },
  })
  assert.strictEqual(result.code, 0)
})

// NO BYPASS — the guard has no bypass phrase; a transcript mimicking one
// does NOT let a blanket marker through.
test('no bypass phrase exists — banned marker still blocked', async () => {
  const transcript = makeTranscript('Allow blanket-file-exclusion bypass')
  const result = await runHook({
    tool_name: 'Write',
    transcript_path: transcript,
    tool_input: {
      file_path: SRC_FILE,
      content: '/* max-file-lines: legitimate */\n',
    },
  })
  assert.strictEqual(result.code, 2)
})

// MALFORMED — garbage stdin fails open (exit 0, no crash).
test('malformed payload fails open', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('not json at all {{{')
  const code: number = await new Promise(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})

// MALFORMED — empty stdin fails open (exit 0, no crash).
test('empty payload fails open', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('')
  const code: number = await new Promise(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})
