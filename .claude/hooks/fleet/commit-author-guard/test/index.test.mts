// node --test specs for the commit-author-guard PreToolUse hook.
//
// The guard reads the cascaded, wheelhouse-scoped identity policy
// (.config/fleet|repo/git-authors.json under the commit cwd). These tests
// build a fake repo with those config files and drive the hook over stdin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface FakeRepo {
  readonly repo: string
  cleanup(): void
}

// Universal denylist every fleet repo ships (mirrors
// template/.config/fleet/git-authors.json). `allowlist` is optional, matching
// the real model where the canonical allowlist is per-repo (.config/repo).
function makeFakeRepo(allowlist?: {
  canonical?: { name?: string; email?: string }
  aliases?: Array<{ name?: string; email?: string }>
}): FakeRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), 'authorguard-'))
  const repo = path.join(root, 'repo')
  mkdirSync(path.join(repo, '.config', 'fleet'), { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'real@socket.dev'], { cwd: repo })
  spawnSync('git', ['config', 'user.name', 'Real Dev'], { cwd: repo })
  writeFileSync(
    path.join(repo, '.config', 'fleet', 'git-authors.json'),
    JSON.stringify({
      denylist: {
        emails: ['*@example.com', '*@example.org', 'you@localhost'],
        names: ['Test', 'User', 'Unknown'],
      },
      canonical: {},
      aliases: [],
    }),
  )
  if (allowlist) {
    mkdirSync(path.join(repo, '.config', 'repo'), { recursive: true })
    writeFileSync(
      path.join(repo, '.config', 'repo', 'git-authors.json'),
      JSON.stringify(allowlist),
    )
  }
  return { repo, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function makeTranscript(dir: string, bypassPhrase?: string): string {
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: bypassPhrase ?? 'normal message' }),
  )
  return transcriptPath
}

function runHook(payload: object): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

// ── Denylist (universal — always blocks, no allowlist needed) ──

test('BLOCKS --author override with a denylisted (placeholder) email', () => {
  const r = makeFakeRepo()
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'git commit --author="Wrong <wrong@example.com>" -m "fix"',
      },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /commit-author-guard/)
    assert.match(stderr, /placeholder/)
  } finally {
    r.cleanup()
  }
})

test('BLOCKS -c user.email override with a denylisted email', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'git -c user.email=imposter@example.com commit -m "fix"',
      },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 2)
  } finally {
    r.cleanup()
  }
})

test('BLOCKS local checkout with a denylisted name (Test)', () => {
  const r = makeFakeRepo()
  try {
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: r.repo })
    spawnSync('git', ['config', 'user.email', 'real@socket.dev'], {
      cwd: r.repo,
    })
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "fix"' },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 2)
  } finally {
    r.cleanup()
  }
})

// ── Denylist-only repo: real off-list emails are ALLOWED (no allowlist) ──

test('ALLOWS a real email when no allowlist is configured (denylist-only repo)', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "fix"' },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

// ── Allowlist configured (.config/repo): off-allowlist real email blocks ──

test('BLOCKS an off-allowlist real email when an allowlist IS configured', () => {
  const r = makeFakeRepo({
    canonical: { name: 'jdalton', email: 'john.david.dalton@gmail.com' },
    aliases: [{ name: 'jdalton', email: 'jdalton@socket.dev' }],
  })
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'git commit --author="Other <other@gmail.com>" -m "fix"',
      },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /allowed identity/)
  } finally {
    r.cleanup()
  }
})

test('ALLOWS the canonical email when an allowlist is configured', () => {
  const r = makeFakeRepo({
    canonical: { name: 'jdalton', email: 'john.david.dalton@gmail.com' },
    aliases: [{ name: 'jdalton', email: 'jdalton@socket.dev' }],
  })
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command:
          'git commit --author="jdalton <john.david.dalton@gmail.com>" -m "fix"',
      },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

test('ALLOWS an allowlisted alias email', () => {
  const r = makeFakeRepo({
    canonical: { name: 'jdalton', email: 'john.david.dalton@gmail.com' },
    aliases: [{ name: 'jdalton', email: 'jdalton@socket.dev' }],
  })
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'git commit --author="jdalton <jdalton@socket.dev>" -m "fix"',
      },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

// ── Non-applicability + bypass ──

test('IGNORES non-Bash tools', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { command: 'git commit --author="Test <test@example.com>"' },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

test('IGNORES git commands that are not commit', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git log --author=anyone' },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

test('IGNORES git config commit.gpgsign (not the commit subcommand)', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git config commit.gpgsign true' },
      transcript_path: makeTranscript(r.repo),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

test('ALLOWS with "Allow commit-author bypass" phrase', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'git commit --author="Wrong <wrong@example.com>" -m "fix"',
      },
      transcript_path: makeTranscript(r.repo, 'Allow commit-author bypass'),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})

test('ALLOWS hyphenless bypass variant "Allow commit author bypass"', () => {
  const r = makeFakeRepo()
  try {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'git commit --author="Wrong <wrong@example.com>" -m "fix"',
      },
      transcript_path: makeTranscript(r.repo, 'Allow commit author bypass'),
      cwd: r.repo,
    })
    assert.equal(exitCode, 0)
  } finally {
    r.cleanup()
  }
})
