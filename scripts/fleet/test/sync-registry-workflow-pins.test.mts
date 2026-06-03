// node --test specs for sync-registry-workflow-pins pure helpers.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  listWorkflowFiles,
  pinLineRe,
  readLocalPinFromGit,
  reconcilePins,
} from '../sync-registry-workflow-pins.mts'

const OLD = 'a3f89d934a9fe9ae1640e4e00c11a2a69dc7c8cb'
const NEW = '67bd6087956fa1d6a9b216e76eafac17d762495b'

function ciYaml(sha: string): string {
  return [
    'jobs:',
    '  ci:',
    `    uses: SocketDev/socket-registry/.github/workflows/ci.yml@${sha} # main (2026-06-02)`,
    '',
  ].join('\n')
}

test('pinLineRe matches the workflow pin + trailing comment', () => {
  const m = pinLineRe('ci').exec(ciYaml(OLD))
  assert.ok(m)
  assert.match(m![0], new RegExp(`ci\\.yml@${OLD}`))
})

test('pinLineRe is workflow-specific (ci does not match provenance line)', () => {
  const line = `    uses: SocketDev/socket-registry/.github/workflows/provenance.yml@${OLD}`
  assert.equal(pinLineRe('ci').test(line), false)
  assert.equal(pinLineRe('provenance').test(line), true)
})

test('reconcilePins reports drift without fixing in report mode', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repin-'))
  try {
    const f = path.join(dir, 'ci.yml')
    writeFileSync(f, ciYaml(OLD))
    const pins = new Map([['ci', { sha: NEW, comment: '# main (2026-05-28)' }]])
    const drift = reconcilePins([f], pins, false)
    assert.equal(drift.length, 1)
    assert.equal(drift[0]!.currentSha, OLD)
    assert.equal(drift[0]!.wantedSha, NEW)
    // report mode leaves the file untouched.
    assert.match(readFileSync(f, 'utf8'), new RegExp(`@${OLD}`))
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('reconcilePins rewrites the pin + comment in fix mode', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repin-'))
  try {
    const f = path.join(dir, 'ci.yml')
    writeFileSync(f, ciYaml(OLD))
    const pins = new Map([['ci', { sha: NEW, comment: '# main (2026-05-28)' }]])
    reconcilePins([f], pins, true)
    const after = readFileSync(f, 'utf8')
    assert.match(after, new RegExp(`ci\\.yml@${NEW} # main \\(2026-05-28\\)`))
    assert.doesNotMatch(after, new RegExp(OLD))
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('reconcilePins is a no-op when already at the wanted SHA', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repin-'))
  try {
    const f = path.join(dir, 'ci.yml')
    writeFileSync(f, ciYaml(NEW))
    const pins = new Map([['ci', { sha: NEW, comment: '# main (2026-05-28)' }]])
    assert.equal(reconcilePins([f], pins, true).length, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

function localYaml(sha: string): string {
  return [
    'jobs:',
    '  self:',
    `    uses: SocketDev/socket-registry/.github/workflows/ci.yml@${sha} # main (2026-05-28)`,
    '',
  ].join('\n')
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', cwd, ...args], {})
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
}

test('readLocalPinFromGit reads _local at origin/main, ignoring a stale working tree (orphan guard)', () => {
  // Stand up a throwaway "socket-registry": origin/main pins NEW, but the
  // working tree still holds OLD (the orphaned SHA). The guard must return
  // NEW — repinning the fleet to the working-tree OLD would re-break CI.
  const root = mkdtempSync(path.join(os.tmpdir(), 'reg-'))
  const remote = path.join(root, 'remote.git')
  const work = path.join(root, 'work')
  const relPath = '.github/workflows/_local-not-for-reuse-ci.yml'
  try {
    spawnSync('git', ['init', '--bare', '-b', 'main', remote], {})
    git(root, 'clone', '--quiet', remote, work)
    git(work, 'config', 'user.email', 't@t.test')
    git(work, 'config', 'user.name', 'test')
    mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true })
    writeFileSync(path.join(work, relPath), localYaml(NEW))
    git(work, 'add', relPath)
    git(work, 'commit', '--quiet', '-m', 'pin NEW')
    git(work, 'push', '--quiet', 'origin', 'main')
    // Now dirty the working tree back to the orphaned OLD without committing.
    writeFileSync(path.join(work, relPath), localYaml(OLD))

    const pin = readLocalPinFromGit('ci', work)
    assert.ok(pin, 'expected a pin from origin/main')
    assert.equal(pin!.sha, NEW)
    assert.equal(pin!.comment, '# main (2026-05-28)')
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('readLocalPinFromGit returns undefined when the ref lacks the file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reg-'))
  const remote = path.join(root, 'remote.git')
  const work = path.join(root, 'work')
  try {
    spawnSync('git', ['init', '--bare', '-b', 'main', remote], {})
    git(root, 'clone', '--quiet', remote, work)
    git(work, 'config', 'user.email', 't@t.test')
    git(work, 'config', 'user.name', 'test')
    writeFileSync(path.join(work, 'README.md'), 'no workflows here\n')
    git(work, 'add', 'README.md')
    git(work, 'commit', '--quiet', '-m', 'init')
    git(work, 'push', '--quiet', 'origin', 'main')
    assert.equal(readLocalPinFromGit('ci', work), undefined)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('listWorkflowFiles returns yml/yaml files, [] when dir absent', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repin-'))
  try {
    assert.deepEqual(listWorkflowFiles(dir), [])
    mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'x')
    writeFileSync(path.join(dir, '.github', 'workflows', 'notes.md'), 'x')
    const files = listWorkflowFiles(dir)
    assert.equal(files.length, 1)
    assert.match(files[0]!, /ci\.yml$/)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})
