// node --test specs for the untrusted-coauthor-guard PreToolUse hook.
//
// The guard reads the cascaded identity policy (.config/{fleet,repo}/
// git-authors.json under the commit cwd) and blocks a Co-authored-by trailer
// for an identity that is not allowlisted. These tests build a fake repo with
// those config files and drive the hook over stdin.

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

function makeFakeRepo(allowlist?: {
  canonical?: { name?: string; email?: string }
  aliases?: Array<{ name?: string; email?: string }>
}): FakeRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coauthorguard-'))
  const repo = path.join(root, 'repo')
  mkdirSync(path.join(repo, '.config', 'fleet'), { recursive: true })
  writeFileSync(
    path.join(repo, '.config', 'fleet', 'git-authors.json'),
    JSON.stringify({
      denylist: { emails: ['*@example.com'], names: ['Test'] },
      canonical: allowlist?.canonical ?? {},
      aliases: allowlist?.aliases ?? [],
    }),
  )
  return {
    repo,
    cleanup() {
      rmSync(root, { force: true, recursive: true })
    },
  }
}

function writeTranscript(phrase: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'coauthor-tx-'))
  const p = path.join(dir, 'session.jsonl')
  writeFileSync(
    p,
    JSON.stringify({ type: 'user', message: { role: 'user', content: phrase } }),
  )
  return p
}

function run(command: string, cwd: string, transcriptPath?: string) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      cwd,
      transcript_path: transcriptPath,
    }),
    env: process.env,
  })
  return { code: typeof r.status === 'number' ? r.status : 0, stderr: String(r.stderr || '') }
}

test('blocks a GitHub-noreply co-author with no allowlist configured', () => {
  const f = makeFakeRepo()
  try {
    const r = run(
      'git commit -m "fix: thing\n\nCo-authored-by: drive-by <260110897+drive-by@users.noreply.github.com>"',
      f.repo,
    )
    assert.equal(r.code, 2)
    assert.match(r.stderr, /unvetted identity/)
  } finally {
    f.cleanup()
  }
})

test('blocks an unknown co-author when an allowlist is configured', () => {
  const f = makeFakeRepo({ canonical: { name: 'Real', email: 'real@socket.dev' } })
  try {
    const r = run(
      'git commit -m "feat: x\n\nCo-authored-by: Someone <someone@gmail.com>"',
      f.repo,
    )
    assert.equal(r.code, 2)
  } finally {
    f.cleanup()
  }
})

test('allows an allowlisted (alias) co-author', () => {
  const f = makeFakeRepo({
    canonical: { name: 'Real', email: 'real@socket.dev' },
    aliases: [{ name: 'Teammate', email: 'mate@socket.dev' }],
  })
  try {
    const r = run(
      'git commit -m "feat: x\n\nCo-authored-by: Teammate <mate@socket.dev>"',
      f.repo,
    )
    assert.equal(r.code, 0)
  } finally {
    f.cleanup()
  }
})

test('allows a commit with no co-author trailer', () => {
  const f = makeFakeRepo()
  try {
    const r = run('git commit -m "chore: routine"', f.repo)
    assert.equal(r.code, 0)
  } finally {
    f.cleanup()
  }
})

test('does not fire on a non-commit git command', () => {
  const f = makeFakeRepo()
  try {
    const r = run('git log --format=%an', f.repo)
    assert.equal(r.code, 0)
  } finally {
    f.cleanup()
  }
})

test('bypass phrase authorizes the untrusted co-author', () => {
  const f = makeFakeRepo()
  try {
    const tx = writeTranscript('Allow untrusted-coauthor bypass')
    const r = run(
      'git commit -m "fix\n\nCo-authored-by: drive-by <1+drive-by@users.noreply.github.com>"',
      f.repo,
      tx,
    )
    assert.equal(r.code, 0)
  } finally {
    f.cleanup()
  }
})

test('a plain non-github-noreply co-author passes when no allowlist is set', () => {
  const f = makeFakeRepo()
  try {
    // No allowlist + not a github-noreply → not the targeted shape, allowed.
    const r = run(
      'git commit -m "x\n\nCo-authored-by: Known Bot <bot@socket.dev>"',
      f.repo,
    )
    assert.equal(r.code, 0)
  } finally {
    f.cleanup()
  }
})

test('fails open on malformed payload', () => {
  const r = spawnSync('node', [HOOK_PATH], { input: 'not json', env: process.env })
  assert.equal(typeof r.status === 'number' ? r.status : 0, 0)
})
