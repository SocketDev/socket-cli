// @ts-expect-error - node:test types via @types/node@catalog work at runtime
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface FakeRepo {
  readonly root: string
  readonly templatePath: string
  readonly claudeMdPath: string
  readonly hookIndexPath: (hookName: string) => string
  cleanup(): void
}

function makeFakeRepo(claudeMdContent: string): FakeRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'newhook-'))
  const templatePath = path.join(root, 'template')
  mkdirSync(path.join(templatePath, '.claude', 'hooks'), { recursive: true })
  const claudeMdPath = path.join(templatePath, 'CLAUDE.md')
  writeFileSync(claudeMdPath, claudeMdContent)
  return {
    root,
    templatePath,
    claudeMdPath,
    hookIndexPath: hookName =>
      path.join(templatePath, '.claude', 'hooks', hookName, 'index.mts'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function makeTranscript(dir: string, bypassPhrase?: string): string {
  const transcriptPath = path.join(dir, 'session.jsonl')
  const userContent = bypassPhrase ?? 'normal message'
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: userContent }),
  )
  return transcriptPath
}

function runHook(payload: object): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('BLOCKS when adding a new hook without CLAUDE.md reference', () => {
  const repo = makeFakeRepo('# CLAUDE.md\n\nNo references at all here.\n')
  try {
    const filePath = repo.hookIndexPath('my-new-hook')
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /new-hook-claude-md-guard/)
    assert.match(stderr, /my-new-hook/)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS when CLAUDE.md has the canonical reference', () => {
  const repo = makeFakeRepo(
    '# CLAUDE.md\n\nA rule sentence (enforced by `.claude/hooks/my-new-hook/`).\n',
  )
  try {
    const filePath = repo.hookIndexPath('my-new-hook')
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS when CLAUDE.md uses trailing-slash-omitted variant', () => {
  const repo = makeFakeRepo(
    '(enforced by `.claude/hooks/my-new-hook`)',
  )
  try {
    const { exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: repo.hookIndexPath('my-new-hook') },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS for _shared/ helper edits', () => {
  const repo = makeFakeRepo('# nothing here')
  try {
    const filePath = path.join(
      repo.templatePath,
      '.claude',
      'hooks',
      '_shared',
      'index.mts',
    )
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS for self (new-hook-claude-md-guard) — chicken-and-egg', () => {
  const repo = makeFakeRepo('# nothing here')
  try {
    const { exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: repo.hookIndexPath('new-hook-claude-md-guard') },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS with "Allow new-hook bypass" phrase', () => {
  const repo = makeFakeRepo('# no reference')
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: repo.hookIndexPath('my-new-hook') },
      transcript_path: makeTranscript(repo.root, 'Allow new-hook bypass'),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS with hyphen variant "Allow new hook bypass"', () => {
  const repo = makeFakeRepo('# no reference')
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: repo.hookIndexPath('my-new-hook') },
      transcript_path: makeTranscript(repo.root, 'Allow new hook bypass'),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES tools other than Write/Edit', () => {
  const repo = makeFakeRepo('# no reference')
  try {
    const { exitCode } = runHook({
      tool_name: 'Read',
      tool_input: { file_path: repo.hookIndexPath('my-new-hook') },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES files outside template/.claude/hooks/*/index.mts', () => {
  const repo = makeFakeRepo('# no reference')
  try {
    const filePath = path.join(repo.templatePath, 'random-other-file.mts')
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath },
      transcript_path: makeTranscript(repo.root),
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES test files inside hook dirs', () => {
  const repo = makeFakeRepo('# no reference')
  try {
    const filePath = path.join(
      repo.templatePath,
      '.claude',
      'hooks',
      'my-new-hook',
      'test',
      'index.test.mts',
    )
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath },
      transcript_path: makeTranscript(repo.root),
    })
    // test/ files don't match HOOK_INDEX_PATH_RE (path doesn't end
    // with /<name>/index.mts — it ends with /test/index.test.mts).
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const repo = makeFakeRepo('# no reference')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: repo.hookIndexPath('my-new-hook') },
        transcript_path: makeTranscript(repo.root),
      }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_NEW_HOOK_CLAUDE_MD_GUARD_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    repo.cleanup()
  }
})
