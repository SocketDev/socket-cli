import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fmtguard-'))
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
  command: string,
  options: {
    readonly bypassPhrase?: string | undefined
    readonly env?: Record<string, string> | undefined
  } = {},
): RunResult {
  const t = makeTranscript(options.bypassPhrase)
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command },
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

// Sanity / valid cases

test('ALLOWS feat: simple', () => {
  const { exitCode } = runHook('git commit -m "feat: add thing"')
  assert.equal(exitCode, 0)
})

test('ALLOWS feat(scope): with scope', () => {
  const { exitCode } = runHook(
    'git commit -m "feat(parser): add ability to parse arrays"',
  )
  assert.equal(exitCode, 0)
})

test('ALLOWS chore!: breaking change', () => {
  const { exitCode } = runHook(
    'git commit -m "chore!: drop support for Node 14"',
  )
  assert.equal(exitCode, 0)
})

test('ALLOWS refactor(api)!: scoped breaking change', () => {
  const { exitCode } = runHook(
    'git commit -m "refactor(api)!: drop legacy /v1 routes"',
  )
  assert.equal(exitCode, 0)
})

test('ALLOWS fix: with no scope and longer description', () => {
  const { exitCode } = runHook(
    'git commit -m "fix: array parsing issue when multiple spaces"',
  )
  assert.equal(exitCode, 0)
})

test('ALLOWS multiple -m flags (header on first)', () => {
  const { exitCode } = runHook(
    'git commit -m "feat: add thing" -m "Body paragraph explaining."',
  )
  assert.equal(exitCode, 0)
})

// Type/format blocks

test('BLOCKS missing type (no colon)', () => {
  const { stderr, exitCode } = runHook('git commit -m "update stuff"')
  assert.equal(exitCode, 2)
  assert.match(stderr, /commit-message-format-guard/)
  assert.match(stderr, /Conventional Commits/)
})

test('BLOCKS empty description', () => {
  const { stderr, exitCode } = runHook('git commit -m "feat:"')
  assert.equal(exitCode, 2)
  assert.match(stderr, /Empty description|empty/i)
})

test('BLOCKS empty description with whitespace-only', () => {
  const { stderr, exitCode } = runHook('git commit -m "feat:   "')
  assert.equal(exitCode, 2)
  assert.match(stderr, /Empty description|empty/i)
})

test('BLOCKS uppercase type', () => {
  const { stderr, exitCode } = runHook('git commit -m "FEAT: parser"')
  assert.equal(exitCode, 2)
  assert.match(stderr, /lowercase|uppercase/i)
})

test('BLOCKS unknown type (feature)', () => {
  const { stderr, exitCode } = runHook(
    'git commit -m "feature(parser): add arrays"',
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /Unknown type|feature/i)
})

test('BLOCKS unknown type (chores)', () => {
  const { stderr, exitCode } = runHook('git commit -m "chores: update deps"')
  assert.equal(exitCode, 2)
  assert.match(stderr, /Unknown type|chores/i)
})

test('Block message includes spec URL', () => {
  const { stderr } = runHook('git commit -m "update stuff"')
  assert.match(stderr, /conventionalcommits\.org\/en\/v1\.0\.0/)
})

test('Block message includes a suggestion', () => {
  const { stderr } = runHook('git commit -m "update parser"')
  assert.match(stderr, /Suggested fix/)
})

// AI-attribution blocks

test('BLOCKS Generated with Claude', () => {
  const { stderr, exitCode } = runHook(
    'git commit -m "feat: add thing" -m "Generated with Claude"',
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /AI-attribution/)
})

test('BLOCKS Generated with Anthropic', () => {
  const { stderr, exitCode } = runHook(
    'git commit -m "feat: add thing" -m "Generated with Anthropic"',
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /AI-attribution/)
})

test('BLOCKS Co-Authored-By Claude', () => {
  const { stderr, exitCode } = runHook(
    'git commit -m "feat: add thing" -m "Co-Authored-By: Claude <noreply@anthropic.com>"',
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /AI-attribution/)
})

test('BLOCKS robot emoji tag', () => {
  const { stderr, exitCode } = runHook(
    'git commit -m "feat: add thing" -m "🤖 Generated"',
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /AI-attribution/)
})

test('BLOCKS noreply@anthropic.com', () => {
  const { stderr, exitCode } = runHook(
    'git commit -m "feat: add thing" -m "Authored by <noreply@anthropic.com>"',
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /AI-attribution/)
})

// Bypass phrases

test('ALLOWS with "Allow commit-format bypass" phrase', () => {
  const { exitCode } = runHook('git commit -m "update stuff"', {
    bypassPhrase: 'Allow commit-format bypass',
  })
  assert.equal(exitCode, 0)
})

test('Format bypass does NOT authorize AI attribution', () => {
  // Both rules trip; format bypass should let format pass but AI
  // attribution should still block.
  const { stderr, exitCode } = runHook(
    'git commit -m "update stuff" -m "Co-Authored-By: Claude"',
    { bypassPhrase: 'Allow commit-format bypass' },
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /AI-attribution/)
})

test('ALLOWS with "Allow ai-attribution bypass" phrase', () => {
  const { exitCode } = runHook(
    'git commit -m "docs: document forbidden strings" -m "We forbid Co-Authored-By: Claude trailers."',
    { bypassPhrase: 'Allow ai-attribution bypass' },
  )
  assert.equal(exitCode, 0)
})

test('AI bypass alone does NOT authorize format errors', () => {
  const { stderr, exitCode } = runHook('git commit -m "update stuff"', {
    bypassPhrase: 'Allow ai-attribution bypass',
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /Conventional Commits/)
})

// Ignore non-commit / non-Bash

test('IGNORES non-Bash tool', () => {
  const t = makeTranscript()
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { command: 'git commit -m "update stuff"' },
        transcript_path: t.transcriptPath,
      }),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0)
  } finally {
    t.cleanup()
  }
})

test('IGNORES non-commit git commands', () => {
  const { exitCode } = runHook('git log --oneline -m "anything"')
  assert.equal(exitCode, 0)
})

test('IGNORES git commit with no inline message (likely -F or editor)', () => {
  const { exitCode } = runHook('git commit -F /tmp/msg.txt')
  assert.equal(exitCode, 0)
})

test('IGNORES git config commit.* (subcommand is config, not commit)', () => {
  const { exitCode } = runHook('git config commit.gpgsign true')
  assert.equal(exitCode, 0)
})

// Quote variants

test('ALLOWS single-quoted message', () => {
  const { exitCode } = runHook("git commit -m 'feat: add thing'")
  assert.equal(exitCode, 0)
})

test('BLOCKS single-quoted invalid message', () => {
  const { exitCode } = runHook("git commit -m 'update stuff'")
  assert.equal(exitCode, 2)
})

test('ALLOWS --message= form', () => {
  const { exitCode } = runHook('git commit --message="feat: add thing"')
  assert.equal(exitCode, 0)
})

test('BLOCKS --message= form with invalid header', () => {
  const { exitCode } = runHook('git commit --message="update stuff"')
  assert.equal(exitCode, 2)
})
