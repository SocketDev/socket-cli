import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  readonly stderr: string
  readonly exitCode: number
}

function makeTranscript(bypassPhrase?: string): {
  readonly transcriptPath: string
  cleanup(): void
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nodlrg-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const userContent = bypassPhrase ?? 'normal message'
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: userContent }),
  )
  return {
    transcriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function runHook(
  payload: Record<string, unknown>,
  options: {
    readonly bypassPhrase?: string | undefined
    readonly env?: Record<string, string> | undefined
  } = {},
): RunResult {
  const t = makeTranscript(options.bypassPhrase)
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        ...payload,
        transcript_path: t.transcriptPath,
      }),
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: 'utf8',
    })
    return {
      stderr: String(result.stderr ?? ''),
      exitCode: result.status ?? -1,
    }
  } finally {
    t.cleanup()
  }
}

// Sanity: non-config files don't trigger

test('ALLOWS edit to non-config file', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/src/index.mts',
      old_string: 'foo',
      new_string: 'bar',
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS non-Edit/Write tools', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  })
  assert.equal(exitCode, 0)
})

// Allow: edits to lint configs that DON'T add rule disables

test('ALLOWS oxlintrc edit that does not add disables', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.config/oxlintrc.json',
      old_string: '"rules": {\n  "foo": "error"\n}',
      new_string: '"rules": {\n  "foo": "error",\n  "bar": "error"\n}',
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS oxlintrc edit that removes a rule-off entry', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.config/oxlintrc.json',
      old_string: '"some-rule": "off"',
      new_string: '"some-rule": "error"',
    },
  })
  assert.equal(exitCode, 0)
})

// Block: edits that add a rule-off

test('BLOCKS oxlintrc Edit that adds a rule-off', () => {
  const { exitCode, stderr } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.config/oxlintrc.json',
      old_string: '"rules": {}',
      new_string: '"rules": {\n  "socket/foo": "off"\n}',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /socket\/foo/)
})

test('BLOCKS oxlintrc Edit that adds a rule-warn', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.config/oxlintrc.json',
      old_string: '"rules": {}',
      new_string: '"rules": {\n  "socket/foo": "warn"\n}',
    },
  })
  assert.equal(exitCode, 2)
})

test('BLOCKS dogfood oxlintrc Edit that adds disables', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.config/oxlintrc.dogfood.json',
      old_string: '"rules": {}',
      new_string: '"rules": {\n  "socket/bar": "off"\n}',
    },
  })
  assert.equal(exitCode, 2)
})

test('BLOCKS template oxlintrc Edit that adds disables', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/template/.config/oxlintrc.json',
      old_string: '"rules": {}',
      new_string: '"rules": {\n  "socket/bar": "off"\n}',
    },
  })
  assert.equal(exitCode, 2)
})

test('BLOCKS .eslintrc.json Edit that adds disables', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.eslintrc.json',
      old_string: '"rules": {}',
      new_string: '"rules": { "no-console": "off" }',
    },
  })
  assert.equal(exitCode, 2)
})

// Bypass

test('ALLOWS with bypass phrase', () => {
  const { exitCode } = runHook(
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: '/repo/.config/oxlintrc.json',
        old_string: '"rules": {}',
        new_string: '"rules": {\n  "socket/foo": "off"\n}',
      },
    },
    { bypassPhrase: 'Allow disable-lint-rule bypass' },
  )
  assert.equal(exitCode, 0)
})

// Write tool: file doesn't exist yet -> baseline = empty

test('BLOCKS Write of new lint config with rule-off', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/nonexistent/.config/oxlintrc.json',
      content: '{"rules": {"some-rule": "off"}}',
    },
  })
  assert.equal(exitCode, 2)
})
