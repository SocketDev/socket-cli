// node --test specs for the plan-location-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end(JSON.stringify(payload))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('non-markdown files pass through', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/script.ts',
      content: '// not a markdown file',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('blocks plan-shaped doc under docs/plans/ at repo root', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/migration-plan.md',
      content: '# Migration plan\n\nSteps:\n\n1. ...',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /plan-location-guard: blocked/)
  assert.match(result.stderr, /docs-plans/)
})

test('blocks plan-shaped doc under package-level docs/plans/', async () => {
  const result = await runHook({
    tool_input: {
      file_path:
        '/Users/x/projects/foo/packages/bar/docs/plans/refactor-plan.md',
      content: '# Refactor plan',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /docs-plans/)
})

test('allows plan under repo-root .claude/plans/', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/.claude/plans/my-plan.md',
      content: '# My plan',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('blocks plan under sub-package .claude/plans/', async () => {
  const result = await runHook({
    tool_input: {
      file_path:
        '/Users/x/projects/foo/packages/bar/.claude/plans/sub-plan.md',
      content: '# Sub-package plan',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /sub-claude-plans/)
})

test('blocks plan under a SECOND .claude/plans/ deeper than the first', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/.claude/plans/outer/.claude/plans/inner.md',
      content: '# Inner plan',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /sub-claude-plans/)
})

test('blocks README.md whose heading mentions "plans" (heading heuristic)', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/README.md',
      content: '# Plans directory\n\nThis directory holds historical plan archives.',
    },
    tool_name: 'Write',
  })
  // Filename ("readme") is benign but the heading "# Plans directory"
  // contains a plan-shape token. The heuristic is intentionally
  // OR-shaped — either signal blocks.
  assert.strictEqual(result.code, 2)
})

test('allows truly-unrelated doc under docs/plans/ that doesn\'t look like a plan', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/index.md',
      content: '# Archive index\n\nLinks to historical artifacts.',
    },
    tool_name: 'Write',
  })
  // Neither filename ("index") nor heading ("Archive index") contains
  // a plan-shape token. Pass-through.
  assert.strictEqual(result.code, 0)
})

test('blocks Edit (not just Write) to plan-shaped path', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/migration-plan.md',
      new_string: 'updated # Migration plan content',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('detects plan via filename when content is missing', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/roadmap.md',
    },
    tool_name: 'Write',
  })
  // Filename contains 'roadmap' — plan-shaped. Block.
  assert.strictEqual(result.code, 2)
})

test('respects bypass phrase in recent user turn', async (t) => {
  // Build a transcript file containing the bypass phrase.
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises')
  const os = await import('node:os')
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'plan-location-test-'))
  const transcriptPath = path.join(tmp, 'session.jsonl')
  const turn = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Allow plan-location bypass' }],
    },
  }
  await writeFile(transcriptPath, JSON.stringify(turn) + '\n', 'utf8')
  t.after(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/docs/plans/migration-plan.md',
      content: '# Migration plan',
    },
    tool_name: 'Write',
    transcript_path: transcriptPath,
  })
  assert.strictEqual(result.code, 0)
})

test('fails open on malformed stdin', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('not valid json')
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const code: number = await new Promise(resolve => {
    child.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
  assert.match(stderr, /fail-open/)
})

test('fails open on empty stdin', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('')
  const code: number = await new Promise(resolve => {
    child.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})
