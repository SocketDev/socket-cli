// @ts-expect-error - node:test types via @types/node@catalog work at runtime
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface ToolUse { name: string; input: Record<string, unknown> }

function makeTranscript(
  assistantText: string,
  toolUses: readonly ToolUse[] = [],
): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'variant-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const content: object[] = [{ type: 'text', text: assistantText }]
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    content.push({ type: 'tool_use', name: toolUses[i]!.name, input: toolUses[i]!.input })
  }
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ role: 'user', content: 'hi' }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content },
      }),
    ].join('\n'),
  )
  return { path: transcriptPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('flags "Critical:" severity without variant search', () => {
  const { path: p, cleanup } = makeTranscript(
    'Found a Critical: prompt injection in agents/foo.md',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /variant-analysis-reminder/)
    assert.match(stderr, /Critical/)
  } finally {
    cleanup()
  }
})

test('flags ● High bullet shape', () => {
  const { path: p, cleanup } = makeTranscript(
    'Findings:\n● High: missing validation on user input',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /High/)
  } finally {
    cleanup()
  }
})

test('flags CRITICAL callout shape', () => {
  const { path: p, cleanup } = makeTranscript(
    '● CRITICAL (1)\n  Some critical issue here.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /CRITICAL/)
  } finally {
    cleanup()
  }
})

test('does NOT flag when Grep ran in same turn', () => {
  const { path: p, cleanup } = makeTranscript(
    'Critical: prompt injection found',
    [{ name: 'Grep', input: { pattern: 'ignore previous' } }],
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag when Glob ran in same turn', () => {
  const { path: p, cleanup } = makeTranscript(
    'High severity: unbound variable',
    [{ name: 'Glob', input: { pattern: '**/*.mts' } }],
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag when Agent (delegated search) ran', () => {
  const { path: p, cleanup } = makeTranscript(
    'Critical: SQL injection vector',
    [{ name: 'Agent', input: { prompt: 'find variants' } }],
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag plain prose without severity labels', () => {
  const { path: p, cleanup } = makeTranscript(
    'I implemented the feature and ran the tests. No issues found.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT false-positive on "Critical" inside code fence', () => {
  const { path: p, cleanup } = makeTranscript(
    'Output:\n```\nCritical: some log message\n```\nMoving on.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT false-positive on "high quality" / "high-performance"', () => {
  const { path: p, cleanup } = makeTranscript(
    'This is a high-performance hashmap and the result is high quality.',
  )
  try {
    const { stderr } = runHook(p)
    // "high" not followed by `:` or `,` shouldn't match — the regex
    // requires lookahead for [:\s,] after the severity word.
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript('Critical: bug found')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_VARIANT_ANALYSIS_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
