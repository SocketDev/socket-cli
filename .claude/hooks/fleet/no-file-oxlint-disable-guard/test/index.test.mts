// node --test specs for the no-file-oxlint-disable-guard hook.
//
// PreToolUse(Edit|Write|MultiEdit) guard. Blocks content that introduces a
// file-scope `oxlint-disable <rule>` comment (block or line form, no
// `-next-line` suffix). Per-call-site `oxlint-disable-next-line <rule> --
// <reason>` and `oxlint-enable <rule>` pass through. Files under the plugin's
// own `rules/` and `test/` dirs are exempt. The guard has NO bypass phrase and
// NO env kill switch — the only escape is the path exemption. Fails open on a
// malformed payload (exit 0).

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
  const dir = mkdtempSync(path.join(tmpdir(), 'no-file-oxlint-disable-guard-'))
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

// A non-exempt source file: outside `.config/fleet/oxlint-plugin/rules|test/`.
const SRC_FILE = '/Users/x/projects/socket-foo/src/widget.mts'

// FIRES — block-comment file-scope disable `/* oxlint-disable <rule> */`.
test('blocks block-comment file-scope oxlint-disable', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '/* oxlint-disable socket/no-console-prefer-logger */\nconsole.log(1)\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-file-oxlint-disable-guard/)
})

// FIRES — line-comment file-scope disable `// oxlint-disable <rule>`.
test('blocks line-comment file-scope oxlint-disable', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: '// oxlint-disable typescript/no-explicit-any\nlet x: any\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-file-oxlint-disable-guard/)
})

// FIRES — Edit tool path (content arrives via `new_string`, not `content`).
test('blocks via Edit new_string field', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: SRC_FILE,
      new_string: '/* oxlint-disable socket/no-underscore-identifier */\n',
    },
  })
  assert.strictEqual(result.code, 2)
})

// FIRES — leading indentation before the comment is still file-scope.
test('blocks an indented file-scope oxlint-disable', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: 'function f() {\n  // oxlint-disable socket/sort-keys\n}\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Line 2/)
})

// FIRES — multiple disables are all reported in the nudge.
test('reports every file-scope disable found', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '// oxlint-disable a/one\nconst a = 1\n/* oxlint-disable b/two */\nconst b = 2\n',
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Line 1/)
  assert.match(result.stderr, /Line 3/)
})

// DOES-NOT-FIRE — per-call-site `oxlint-disable-next-line` is the allowed shape.
test('allows oxlint-disable-next-line (block + line forms)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        '// oxlint-disable-next-line socket/foo -- justified here\nconst a = 1\n/* oxlint-disable-next-line socket/bar */\nconst b = 2\n',
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// DOES-NOT-FIRE — `oxlint-enable` re-enables and is not a disable.
test('allows oxlint-enable', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: '/* oxlint-enable socket/no-console-prefer-logger */\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// DOES-NOT-FIRE — clean source with no oxlint directive at all.
test('allows clean content with no oxlint directive', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: 'export function add(a: number, b: number) {\n  return a + b\n}\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// DOES-NOT-FIRE — `oxlint-disable` only as substring mid-line (not a comment
// opener at line start) does not match the anchored regex.
test('allows oxlint-disable appearing mid-line in code/string', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "const msg = 'see oxlint-disable in the docs'\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

// EXEMPTION — files under the plugin's own rules/ dir may file-scope-disable.
test('allows file-scope disable under oxlint-plugin/rules/', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path:
        '/Users/x/socket-foo/.config/fleet/oxlint-plugin/rules/no-foo.mts',
      content: '/* oxlint-disable socket/no-foo */\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// EXEMPTION — files under the plugin's own test/ dir are exempt too.
test('allows file-scope disable under oxlint-plugin/test/', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path:
        '/Users/x/socket-foo/.config/fleet/oxlint-plugin/test/no-foo.test.mts',
      content: '// oxlint-disable socket/no-foo\n',
    },
  })
  assert.strictEqual(result.code, 0)
})

// PASS-THROUGH — non-Edit/Write tool is out of scope for withEditGuard.
test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: '/* oxlint-disable socket/no-foo */' },
  })
  assert.strictEqual(result.code, 0)
})

// PASS-THROUGH — Edit/Write payload with no file_path is ignored.
test('Edit payload without file_path passes through', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: { new_string: '/* oxlint-disable socket/no-foo */\n' },
  })
  assert.strictEqual(result.code, 0)
})

// NO BYPASS — the guard has no bypass phrase; a transcript that mimics one
// does NOT let a banned file-scope disable through.
test('no bypass phrase exists — banned shape still blocked with transcript', async () => {
  const transcript = makeTranscript('Allow file-oxlint-disable bypass')
  const result = await runHook({
    tool_name: 'Write',
    transcript_path: transcript,
    tool_input: {
      file_path: SRC_FILE,
      content: '/* oxlint-disable socket/no-foo */\n',
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
