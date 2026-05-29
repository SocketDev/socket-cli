import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { compressMCPOutput, isMCPToolName } from '../index.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function runHook(payload: object): {
  stdout: string
  exitCode: number
} {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
  })
  return { stdout: String(result.stdout), exitCode: result.status ?? -1 }
}

// ---------- isMCPToolName ----------

test('isMCPToolName: accepts mcp__ prefix', () => {
  assert.equal(isMCPToolName('mcp__github__list_repos'), true)
  assert.equal(isMCPToolName('mcp__playwright__navigate'), true)
})

test('isMCPToolName: rejects built-in tool names', () => {
  for (const name of ['Read', 'Bash', 'Edit', 'Write', 'Grep']) {
    assert.equal(isMCPToolName(name), false)
  }
})

test('isMCPToolName: rejects undefined / wrong type', () => {
  assert.equal(isMCPToolName(undefined), false)
  assert.equal(isMCPToolName(''), false)
})

// ---------- compressMCPOutput ----------

test('compressMCPOutput: minifies string-shaped response', () => {
  const got = compressMCPOutput('     1\thello\n     2\tworld\n')
  assert.equal(got, 'hello\nworld\n')
})

test('compressMCPOutput: minifies text block in object', () => {
  const got = compressMCPOutput({
    type: 'text',
    text: '\n\n\n\nfoo\n',
  })
  assert.deepEqual(got, { type: 'text', text: '\n\nfoo\n' })
})

test('compressMCPOutput: minifies text blocks in arrays', () => {
  const got = compressMCPOutput([
    { type: 'text', text: '     1\tline a\n' },
    { type: 'text', text: '     2\tline b\n' },
  ])
  assert.deepEqual(got, [
    { type: 'text', text: 'line a\n' },
    { type: 'text', text: 'line b\n' },
  ])
})

test('compressMCPOutput: walks into nested content fields', () => {
  const got = compressMCPOutput({
    content: [{ type: 'text', text: '     1\tfoo\n' }],
  })
  assert.deepEqual(got, {
    content: [{ type: 'text', text: 'foo\n' }],
  })
})

test('compressMCPOutput: passes through non-text blocks', () => {
  const input = {
    type: 'image',
    source: { data: 'abc', media_type: 'image/png' },
  }
  assert.deepEqual(compressMCPOutput(input), input)
})

test('compressMCPOutput: passes through primitives that aren’t strings', () => {
  assert.equal(compressMCPOutput(42), 42)
  assert.equal(compressMCPOutput(true), true)
  assert.equal(compressMCPOutput(undefined), null)
})

test('compressMCPOutput: minifies JSON-shaped strings', () => {
  const got = compressMCPOutput('{\n  "a": 1,\n  "b": 2\n}')
  assert.equal(got, '{"a":1,"b":2}')
})

// ---------- hook IO ----------

test('hook: SKIPS non-PostToolUse events', () => {
  const { stdout, exitCode } = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__x__y',
    tool_response: 'whatever',
  })
  assert.equal(exitCode, 0)
  assert.equal(stdout.trim(), '')
})

test('hook: SKIPS built-in tools', () => {
  const { stdout, exitCode } = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_response: { content: 'whatever' },
  })
  assert.equal(exitCode, 0)
  assert.equal(stdout.trim(), '')
})

test('hook: SKIPS when tool_response is absent', () => {
  const { stdout, exitCode } = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__x__y',
  })
  assert.equal(exitCode, 0)
  assert.equal(stdout.trim(), '')
})

test('hook: emits updatedMCPToolOutput for MCP tool with text content', () => {
  const { stdout, exitCode } = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__github__list_repos',
    tool_response: [{ type: 'text', text: '     1\tfoo\n     2\tbar\n' }],
  })
  assert.equal(exitCode, 0)
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: {
      hookEventName: string
      updatedMCPToolOutput: Array<{ text: string }>
    }
  }
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.equal(
    parsed.hookSpecificOutput.updatedMCPToolOutput[0]!.text,
    'foo\nbar\n',
  )
})

test('hook: emits updatedMCPToolOutput for MCP tool with string-shaped response', () => {
  const { stdout, exitCode } = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__custom__tool',
    tool_response: '{\n  "x": 1\n}',
  })
  assert.equal(exitCode, 0)
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { updatedMCPToolOutput: string }
  }
  assert.equal(parsed.hookSpecificOutput.updatedMCPToolOutput, '{"x":1}')
})

test('hook: fails open on malformed stdin', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: '{not json',
  })
  assert.equal(result.status, 0)
  assert.equal(String(result.stdout).trim(), '')
})
