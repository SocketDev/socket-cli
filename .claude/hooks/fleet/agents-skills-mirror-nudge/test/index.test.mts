// node --test specs for the agents-skills-mirror-nudge hook.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const mod = await import(path.join(here, '..', 'index.mts'))
const { isSkillSourcePath, mirrorIsStale, parseChangedPaths } = mod as {
  isSkillSourcePath: (file: string) => boolean
  mirrorIsStale: (repoDir: string) => boolean
  parseChangedPaths: (subcommand: string, stdout: string) => string[]
}

test('isSkillSourcePath: .claude/skills/ paths only', () => {
  assert.equal(isSkillSourcePath('.claude/skills/fleet/foo/SKILL.md'), true)
  assert.equal(isSkillSourcePath('.claude/skills/repo/bar/reference.md'), true)
  assert.equal(isSkillSourcePath('.claude/hooks/fleet/foo/index.mts'), false)
  assert.equal(isSkillSourcePath('.agents/skills/fleet-foo/SKILL.md'), false)
  assert.equal(isSkillSourcePath('README.md'), false)
})

test('parseChangedPaths: status strips the 2-char prefix', () => {
  const out = parseChangedPaths(
    'status',
    ' M .claude/skills/repo/foo/SKILL.md\n?? new.txt\n',
  )
  assert.deepEqual(out, ['.claude/skills/repo/foo/SKILL.md', 'new.txt'])
})

test('parseChangedPaths: diff lines are bare paths', () => {
  const out = parseChangedPaths(
    'diff',
    '.claude/skills/fleet/foo/SKILL.md\nREADME.md\n',
  )
  assert.deepEqual(out, ['.claude/skills/fleet/foo/SKILL.md', 'README.md'])
})

test('parseChangedPaths: empty/blank output → []', () => {
  assert.deepEqual(parseChangedPaths('status', ''), [])
  assert.deepEqual(parseChangedPaths('diff', '\n\n'), [])
})

test('mirrorIsStale: no generator present → false (no-op)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mirror-nudge-gen-'))
  assert.equal(mirrorIsStale(dir), false)
})
