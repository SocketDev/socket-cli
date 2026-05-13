/**
 * @fileoverview Unit tests for no-orphaned-staging hook.
 *
 * Test strategy: create a temp git repo, stage a file (or not), spawn
 * the hook with CLAUDE_PROJECT_DIR pointed at the temp repo, and
 * inspect stderr.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, test } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  code: number
  stderr: string
}

function runHook(env: Record<string, string>): RunResult {
  const r = spawnSync('node', [HOOK], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    stderr: r.stderr || '',
  }
}

function git(repoDir: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
}

let tmpRepo: string

beforeEach(() => {
  tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'no-orphaned-staging-'))
  git(tmpRepo, ['init', '-q'])
  git(tmpRepo, ['config', 'user.email', 'test@example.com'])
  git(tmpRepo, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(tmpRepo, 'README.md'), '# test\n')
  git(tmpRepo, ['add', 'README.md'])
  git(tmpRepo, ['commit', '-q', '-m', 'initial'])
})

afterEach(() => {
  rmSync(tmpRepo, { recursive: true, force: true })
})

describe('no-orphaned-staging', () => {
  test('clean index → silent', () => {
    const r = runHook({ CLAUDE_PROJECT_DIR: tmpRepo })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
  })

  test('staged file → warning', () => {
    writeFileSync(path.join(tmpRepo, 'foo.txt'), 'staged content\n')
    git(tmpRepo, ['add', 'foo.txt'])
    const r = runHook({ CLAUDE_PROJECT_DIR: tmpRepo })
    assert.equal(r.code, 0)
    assert.match(r.stderr, /no-orphaned-staging/)
    assert.match(r.stderr, /foo\.txt/)
  })

  test('multiple staged files listed', () => {
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      writeFileSync(path.join(tmpRepo, name), `${name}\n`)
      git(tmpRepo, ['add', name])
    }
    const r = runHook({ CLAUDE_PROJECT_DIR: tmpRepo })
    assert.equal(r.code, 0)
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      assert.match(r.stderr, new RegExp(name))
    }
  })

  test('disabled via env → silent even when staged', () => {
    writeFileSync(path.join(tmpRepo, 'foo.txt'), 'staged content\n')
    git(tmpRepo, ['add', 'foo.txt'])
    const r = runHook({
      CLAUDE_PROJECT_DIR: tmpRepo,
      SOCKET_NO_ORPHANED_STAGING_DISABLED: '1',
    })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
  })

  test('non-repo dir → silent (not a git repo)', () => {
    const nonRepo = mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))
    try {
      const r = runHook({ CLAUDE_PROJECT_DIR: nonRepo })
      assert.equal(r.code, 0)
      // git returns non-zero exit + the helper returns empty list.
      assert.equal(r.stderr, '')
    } finally {
      rmSync(nonRepo, { recursive: true, force: true })
    }
  })

  test('truncates listing past 10 files', () => {
    for (let i = 0; i < 15; i += 1) {
      const name = `f${i}.txt`
      writeFileSync(path.join(tmpRepo, name), `${name}\n`)
      git(tmpRepo, ['add', name])
    }
    const r = runHook({ CLAUDE_PROJECT_DIR: tmpRepo })
    assert.match(r.stderr, /and 5 more/)
  })

  test('fail-open on hook bug', () => {
    // Empty stdin would normally drain; verifying the hook doesn't
    // crash on missing-env-vars or other edge cases.
    const r = spawnSync('node', [HOOK], {
      input: '',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: '/nonexistent/path' },
    })
    assert.equal(r.status, 0)
  })
})
