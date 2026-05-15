import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(userText?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pcg-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: userText ?? 'normal message' }),
  )
  return transcriptPath
}

function runHook(
  tool: 'Edit' | 'Write' | 'Read',
  filePath: string,
  content: string,
  options: { transcriptPath?: string; env?: Record<string, string> } = {},
): { stderr: string; exitCode: number } {
  const payload: Record<string, unknown> = {
    tool_name: tool,
    tool_input: { file_path: filePath, content, new_string: content },
  }
  if (options.transcriptPath) {
    payload['transcript_path'] = options.transcriptPath
  }
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('FLAGS bare "See the @fileoverview JSDoc above."', () => {
  const content = [
    "export const x = 1",
    "// See the @fileoverview JSDoc above.",
    'export const StringPrototypeEndsWith = uncurry()',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/foo.ts', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /pointer-comment-guard/)
  assert.match(stderr, /See the @fileoverview/)
})

test('FLAGS bare "Full rationale in the fileoverview."', () => {
  const content = [
    "// Full rationale in the fileoverview.",
    'export const x = 1',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/bar.ts', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /Full rationale/)
})

test('FLAGS bare "See X for details."', () => {
  const content = [
    "// See X for details.",
    'export const x = 1',
  ].join('\n')
  const { exitCode } = runHook('Write', '/repo/src/baz.ts', content)
  assert.equal(exitCode, 0)
})

test('ACCEPTS pointer + claim form (current breadcrumb shape)', () => {
  const content = [
    "// Why uncurried, not Fast-API'd: see the fileoverview JSDoc above.",
    "// V8's existing hot path beats trampoline overhead on these.",
    'export const StringPrototypeEndsWith = uncurry()',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/string.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ACCEPTS claim-first-then-pointer form (alternate)', () => {
  const content = [
    "// Searches stay uncurried — V8's hot path beats any Fast API",
    "// binding here. Full rationale in the @fileoverview JSDoc above.",
    'export const StringPrototypeEndsWith = uncurry()',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/string.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ACCEPTS pointer with claim via "because"', () => {
  const content = [
    "// See the upstream spec for details, because the ordering matters here.",
    'export const x = 1',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/x.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ACCEPTS plain non-pointer comments', () => {
  const content = [
    "// This is a regular comment about the constraint.",
    'export const x = 1',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/x.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ACCEPTS prose containing "see" not as a pointer opener', () => {
  // "see" inside a sentence, not opening the comment.
  const content = [
    "// I'll see if this works in practice — it doesn't on Node 18.",
    'export const x = 1',
  ].join('\n')
  const { stderr, exitCode } = runHook('Write', '/repo/src/x.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('IGNORES non-source extensions (markdown, json)', () => {
  const content = [
    "// See the @fileoverview JSDoc above.",
  ].join('\n')
  const md = runHook('Write', '/repo/docs/foo.md', content)
  const json = runHook('Write', '/repo/data.json', content)
  assert.equal(md.exitCode, 0)
  assert.equal(md.stderr, '')
  assert.equal(json.exitCode, 0)
  assert.equal(json.stderr, '')
})

test('IGNORES test files (illustrative pointer-only comments are fine there)', () => {
  const content = [
    "// See X for details.",
    'export const x = 1',
  ].join('\n')
  const testDir = runHook('Write', '/repo/test/foo.ts', content)
  const testFile = runHook('Write', '/repo/src/foo.test.ts', content)
  assert.equal(testDir.exitCode, 0)
  assert.equal(testDir.stderr, '')
  assert.equal(testFile.exitCode, 0)
  assert.equal(testFile.stderr, '')
})

test('IGNORES non-Edit/Write tools', () => {
  const content = "// See X for details."
  const { exitCode, stderr } = runHook('Read', '/repo/src/foo.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ACCEPTS with "Allow pointer-comment bypass" phrase', () => {
  const t = makeTranscript('Allow pointer-comment bypass')
  const content = "// See the @fileoverview JSDoc above."
  const { exitCode, stderr } = runHook('Write', '/repo/src/foo.ts', content, {
    transcriptPath: t,
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('disabled env var short-circuits', () => {
  const content = "// See the @fileoverview JSDoc above."
  const { exitCode, stderr } = runHook('Write', '/repo/src/foo.ts', content, {
    env: { SOCKET_POINTER_COMMENT_GUARD_DISABLED: '1' },
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('handles block comments — bare pointer in /* … */ is flagged', () => {
  const content = [
    '/**',
    ' * See the @fileoverview JSDoc above.',
    ' */',
    'export const x = 1',
  ].join('\n')
  const { exitCode, stderr } = runHook('Write', '/repo/src/foo.ts', content)
  assert.equal(exitCode, 0)
  assert.match(stderr, /See the @fileoverview/)
})

test('handles block comments — pointer + claim in /* … */ passes', () => {
  const content = [
    '/**',
    " * See the @fileoverview JSDoc above. The hot path beats the trampoline.",
    ' */',
    'export const x = 1',
  ].join('\n')
  const { exitCode, stderr } = runHook('Write', '/repo/src/foo.ts', content)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('does not crash on malformed payload', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: 'not-json',
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})

test('does not crash when content is missing', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/repo/src/foo.ts' },
    }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})
