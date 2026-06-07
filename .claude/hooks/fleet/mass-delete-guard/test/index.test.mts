/**
 * @file Unit tests for mass-delete-guard hook.
 *
 *   - catastrophicReason() thresholds (pure).
 *   - Integration: a `git commit` staging many deletions in a temp repo is
 *     blocked (exit 2); a small deletion passes (exit 0); the bypass phrase and
 *     FLEET_SYNC sentinel pass.
 */

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, test } from 'node:test'

import { catastrophicReason } from '../index.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  readonly code: number
  readonly stderr: string
}

function runHook(
  command: string,
  options: {
    cwd?: string | undefined
    transcriptPath?: string | undefined
  } = {},
): RunResult {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    transcript_path: options.transcriptPath,
  })
  const r = spawnSync('node', [HOOK], {
    cwd: options.cwd,
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: options.cwd ?? process.cwd() },
  })
  return { code: r.status ?? 0, stderr: String(r.stderr ?? '') }
}

function git(repo: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
}

let tmpRepo: string

beforeEach(() => {
  tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'mass-delete-guard-'))
  git(tmpRepo, ['init', '-q'])
  git(tmpRepo, ['config', 'user.email', 't@t.co'])
  git(tmpRepo, ['config', 'user.name', 't'])
  git(tmpRepo, ['config', 'commit.gpgsign', 'false'])
})

afterEach(() => {
  rmSync(tmpRepo, { recursive: true, force: true })
})

function seedFiles(repo: string, count: number): void {
  const names: string[] = []
  for (let i = 0; i < count; i += 1) {
    const name = `f${i}.txt`
    writeFileSync(path.join(repo, name), `${i}\n`)
    names.push(name)
  }
  git(repo, ['add', ...names])
  git(repo, ['commit', '-qm', 'seed'])
}

test('catastrophicReason: floor', () => {
  // 50+ deletions trips regardless of tree size.
  assert.ok(catastrophicReason(50, 10_000))
  assert.equal(catastrophicReason(49, 10_000), undefined)
})

test('catastrophicReason: ratio', () => {
  // >75% of a small tree trips even under the floor.
  assert.ok(catastrophicReason(8, 10))
  assert.equal(catastrophicReason(7, 10), undefined)
})

test('blocks a commit staging mass deletions (≥50)', () => {
  seedFiles(tmpRepo, 60)
  // Stage deletion of 55 files.
  const toDelete: string[] = []
  for (let i = 0; i < 55; i += 1) {
    toDelete.push(`f${i}.txt`)
  }
  git(tmpRepo, ['rm', '-q', ...toDelete])
  const { code, stderr } = runHook('git commit -m wipe', { cwd: tmpRepo })
  assert.equal(code, 2)
  assert.match(stderr, /mass-delete-guard/)
})

test('passes a small deletion (under both thresholds)', () => {
  seedFiles(tmpRepo, 60)
  git(tmpRepo, ['rm', '-q', 'f0.txt', 'f1.txt'])
  const { code } = runHook('git commit -m tidy', { cwd: tmpRepo })
  assert.equal(code, 0)
})

test('passes when nothing is staged for deletion', () => {
  seedFiles(tmpRepo, 60)
  writeFileSync(path.join(tmpRepo, 'new.txt'), 'x\n')
  git(tmpRepo, ['add', 'new.txt'])
  const { code } = runHook('git commit -m add', { cwd: tmpRepo })
  assert.equal(code, 0)
})

test('FLEET_SYNC sentinel bypasses', () => {
  seedFiles(tmpRepo, 60)
  const toDelete: string[] = []
  for (let i = 0; i < 55; i += 1) {
    toDelete.push(`f${i}.txt`)
  }
  git(tmpRepo, ['rm', '-q', ...toDelete])
  const { code } = runHook('FLEET_SYNC=1 git commit -m cascade', {
    cwd: tmpRepo,
  })
  assert.equal(code, 0)
})

test('ignores non-commit git commands', () => {
  seedFiles(tmpRepo, 60)
  const { code } = runHook('git status', { cwd: tmpRepo })
  assert.equal(code, 0)
})
