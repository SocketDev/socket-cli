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
  readonly home: string
  readonly authorsJsonPath: string
  cleanup(): void
}

function makeFakeRepo(canonicalEmail = 'john.david.dalton@gmail.com'): FakeRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'authorguard-'))
  const home = path.join(root, 'home')
  mkdirSync(path.join(home, '.claude'), { recursive: true })
  // Init a git repo so `git config user.email` calls don't error out.
  const repo = path.join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: repo })
  spawnSync('git', ['config', 'user.email', canonicalEmail], { cwd: repo })
  spawnSync('git', ['config', 'user.name', 'jdalton'], { cwd: repo })
  const authorsJsonPath = path.join(home, '.claude', 'git-authors.json')
  writeFileSync(
    authorsJsonPath,
    JSON.stringify({
      canonical: { name: 'jdalton', email: canonicalEmail },
      aliases: [{ name: 'jdalton', email: 'jdalton@socket.dev' }],
    }),
  )
  return {
    root,
    home,
    authorsJsonPath,
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

function runHook(
  payload: object,
  home: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, ...extraEnv },
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('BLOCKS --author override with wrong email', () => {
  const repo = makeFakeRepo()
  try {
    const { stderr, exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command: 'git commit --author="Wrong <wrong@example.com>" -m "fix"',
        },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 2)
    assert.match(stderr, /commit-author-guard/)
    assert.match(stderr, /wrong@example\.com/)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS --author override with canonical email', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command:
            'git commit --author="jdalton <john.david.dalton@gmail.com>" -m "fix"',
        },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS --author override with allowlisted alias email', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command:
            'git commit --author="jdalton <jdalton@socket.dev>" -m "fix"',
        },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('BLOCKS -c user.email override with wrong email', () => {
  const repo = makeFakeRepo()
  try {
    const { stderr, exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command: 'git -c user.email=imposter@example.com commit -m "fix"',
        },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 2)
    assert.match(stderr, /imposter@example\.com/)
  } finally {
    repo.cleanup()
  }
})

test('BLOCKS when local checkout has wrong user.email and no override', () => {
  const repo = makeFakeRepo()
  try {
    // Reset the repo's user.email to a wrong value, simulating a corrupted
    // local checkout config.
    spawnSync(
      'git',
      ['config', 'user.email', 'imposter@example.com'],
      { cwd: path.join(repo.root, 'repo') },
    )
    const { stderr, exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 2)
    assert.match(stderr, /imposter@example\.com/)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS plain git commit when local checkout is canonical', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES non-Bash tools', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Write',
        tool_input: { command: 'git commit --author="Wrong <w@e.com>" -m "x"' },
        transcript_path: makeTranscript(repo.root),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES git commands that are not commit', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git log --author=anyone' },
        transcript_path: makeTranscript(repo.root),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES git config commit.gpgsign (must not match commit subcommand)', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git config commit.gpgsign true' },
        transcript_path: makeTranscript(repo.root),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS with "Allow commit-author bypass" phrase', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command: 'git commit --author="Wrong <w@e.com>" -m "fix"',
        },
        transcript_path: makeTranscript(repo.root, 'Allow commit-author bypass'),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS with hyphenless variant "Allow commit author bypass"', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command: 'git commit --author="Wrong <w@e.com>" -m "fix"',
        },
        transcript_path: makeTranscript(repo.root, 'Allow commit author bypass'),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const repo = makeFakeRepo()
  try {
    const { exitCode } = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command: 'git commit --author="Wrong <w@e.com>" -m "fix"',
        },
        transcript_path: makeTranscript(repo.root),
        cwd: path.join(repo.root, 'repo'),
      },
      repo.home,
      { SOCKET_COMMIT_AUTHOR_GUARD_DISABLED: '1' },
    )
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('fails open when no canonical email is configured anywhere', () => {
  // Delete the git-authors.json AND clear global git config email
  // path is checked separately — here we just ensure the JSON path
  // missing means we use the global config (which may or may not be set).
  // The hook should not block when it has no canonical to enforce.
  const root = mkdtempSync(path.join(tmpdir(), 'authorguard-empty-'))
  const home = path.join(root, 'home')
  mkdirSync(path.join(home, '.claude'), { recursive: true })
  const repo = path.join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'whoever@example.com'], { cwd: repo })
  try {
    // The hook will fall back to the user's REAL global git config. Since
    // we can't safely unset that, we just verify the hook doesn't crash on
    // a missing git-authors.json. If global config is also unset, the hook
    // fails open; if it's set to the user's real email, this test's
    // imposter email gets blocked. Either way, the hook should not crash.
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix"' },
        cwd: repo,
      }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    })
    // Exit code is either 0 (fail open) or 2 (real global config caught it);
    // never -1 (crash).
    assert.ok(result.status === 0 || result.status === 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
