import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface ToolUse {
  name: string
  input: Record<string, unknown>
}

function makeTranscript(
  assistantText: string,
  toolUses: readonly ToolUse[] = [],
): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compound-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const content: object[] = [{ type: 'text', text: assistantText }]
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    content.push({
      type: 'tool_use',
      name: toolUses[i]!.name,
      input: toolUses[i]!.input,
    })
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
  return {
    path: transcriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

interface AssistantTurn {
  text: string
  toolUses?: readonly ToolUse[]
}

function makeMultiTurnTranscript(
  turns: readonly AssistantTurn[],
): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compound-multi-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines: string[] = []
  for (let i = 0, { length } = turns; i < length; i += 1) {
    const turn = turns[i]!
    lines.push(JSON.stringify({ role: 'user', content: 'continue' }))
    const content: object[] = [{ type: 'text', text: turn.text }]
    const uses = turn.toolUses ?? []
    for (let j = 0, ul = uses.length; j < ul; j += 1) {
      content.push({
        type: 'tool_use',
        name: uses[j]!.name,
        input: uses[j]!.input,
      })
    }
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content },
      }),
    )
  }
  writeFileSync(transcriptPath, lines.join('\n'))
  return {
    path: transcriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

test('flags "again" repeat-finding', () => {
  const { path: p, cleanup } = makeTranscript(
    'Hitting the same regex bug again. Fixed it.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /compound-lessons-reminder/)
    assert.match(stderr, /again/)
  } finally {
    cleanup()
  }
})

test('flags "second time" repeat-finding', () => {
  const { path: p, cleanup } = makeTranscript(
    'This is the second time we have seen this regex bug.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /second/i)
  } finally {
    cleanup()
  }
})

test('flags "same X as before"', () => {
  const { path: p, cleanup } = makeTranscript(
    'Same monthCode resolution bug as we saw before — patched.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /same/i)
  } finally {
    cleanup()
  }
})

test('flags "we have seen this before"', () => {
  const { path: p, cleanup } = makeTranscript(
    'We have seen this before in the temporal_rs port.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /seen/i)
  } finally {
    cleanup()
  }
})

test('does NOT flag when CLAUDE.md was edited (rule promotion)', () => {
  const { path: p, cleanup } = makeTranscript(
    'Hitting the same regex bug again. Promoting to a rule.',
    [
      {
        name: 'Edit',
        input: { file_path: '/repo/template/CLAUDE.md', new_string: '...' },
      },
    ],
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag when a new hook is added', () => {
  const { path: p, cleanup } = makeTranscript(
    'Second time hitting this. Adding a hook for it.',
    [
      {
        name: 'Write',
        input: {
          file_path: '/repo/template/.claude/hooks/new-rule/index.mts',
          content: '...',
        },
      },
    ],
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag when **Why:** citation is present', () => {
  const { path: p, cleanup } = makeTranscript(
    'Same bug as before. New rule:\n\n**Why:** prior incident in commit abc123 where mock test masked prod failure.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag plain prose', () => {
  const { path: p, cleanup } = makeTranscript(
    'The cache stores parsed results keyed by file path.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT false-positive on "again" inside code fence', () => {
  const { path: p, cleanup } = makeTranscript(
    'Code:\n```\nrun again to verify\n```\nMoved on.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript('Hitting this again.')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      env: { ...process.env, SOCKET_COMPOUND_LESSONS_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})

// Behavioral signal — repeated edits to fleet-canonical surfaces.

test('flags repeat edit to same hook file across turns', () => {
  const { path: p, cleanup } = makeMultiTurnTranscript([
    {
      text: 'First fix.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/template/.claude/hooks/fleet/my-hook/index.mts',
            old_string: 'a',
            new_string: 'b',
          },
        },
      ],
    },
    {
      text: 'Patching it again.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/template/.claude/hooks/fleet/my-hook/index.mts',
            old_string: 'b',
            new_string: 'c',
          },
        },
      ],
    },
  ])
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /compound-lessons-reminder/)
    assert.match(stderr, /repeat-edit/)
    assert.match(stderr, /my-hook/)
  } finally {
    cleanup()
  }
})

test('does NOT flag repeat edit when current turn has **Why:** citation', () => {
  const { path: p, cleanup } = makeMultiTurnTranscript([
    {
      text: 'First fix.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/template/CLAUDE.md',
            old_string: 'a',
            new_string: 'b',
          },
        },
      ],
    },
    {
      text: 'Adding the rule.\n\n**Why:** the regex bug already cost us two PRs.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/template/CLAUDE.md',
            old_string: 'b',
            new_string: 'c',
          },
        },
      ],
    },
  ])
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag edits to non-fleet-canonical paths', () => {
  const { path: p, cleanup } = makeMultiTurnTranscript([
    {
      text: 'First edit.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/src/app.ts',
            old_string: 'a',
            new_string: 'b',
          },
        },
      ],
    },
    {
      text: 'Another edit to the same file.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/src/app.ts',
            old_string: 'b',
            new_string: 'c',
          },
        },
      ],
    },
  ])
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('detects repeat edit beyond immediate prior turn (lookback)', () => {
  const { path: p, cleanup } = makeMultiTurnTranscript([
    {
      text: 'Turn A: patch hook.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/template/.claude/hooks/fleet/my-hook/index.mts',
            old_string: 'a',
            new_string: 'b',
          },
        },
      ],
    },
    { text: 'Turn B: unrelated work.' },
    { text: 'Turn C: more unrelated work.' },
    {
      text: 'Turn D: patching the hook again.',
      toolUses: [
        {
          name: 'Edit',
          input: {
            file_path: '/repo/template/.claude/hooks/fleet/my-hook/index.mts',
            old_string: 'b',
            new_string: 'c',
          },
        },
      ],
    },
  ])
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /repeat-edit/)
    assert.match(stderr, /my-hook/)
  } finally {
    cleanup()
  }
})
