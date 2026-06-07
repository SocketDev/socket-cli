// node --test specs for the dogfood-cascade-reminder hook.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const mod = await import(path.join(here, '..', 'index.mts'))
const { fleetBlock, isUncascaded } = mod as {
  fleetBlock: (s: string) => string | undefined
  isUncascaded: (repoDir: string, templateRel: string) => boolean
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dogfood-'))
  mkdirSync(path.join(dir, 'template'), { recursive: true })
  return dir
}

// Write both a template/<rel> and (optionally) its dogfood twin ./<rel>.
function pair(dir: string, rel: string, tpl: string, twin?: string): void {
  const tA = path.join(dir, 'template', rel)
  mkdirSync(path.dirname(tA), { recursive: true })
  writeFileSync(tA, tpl)
  if (twin !== undefined) {
    const dA = path.join(dir, rel)
    mkdirSync(path.dirname(dA), { recursive: true })
    writeFileSync(dA, twin)
  }
}

test('fleetBlock extracts the BEGIN…END region', () => {
  const doc =
    '# CLAUDE.md\npreamble\n<!-- BEGIN FLEET-CANONICAL -->\nrules\n<!-- END FLEET-CANONICAL -->\npost\n'
  const block = fleetBlock(doc)
  assert.ok(block)
  assert.ok(block.includes('rules'))
  assert.ok(!block.includes('preamble'))
  assert.ok(!block.includes('post'))
})

test('fleetBlock returns undefined when markers absent', () => {
  assert.equal(fleetBlock('no markers here'), undefined)
})

test('matching twin is NOT flagged (byte-identical)', () => {
  const dir = makeRepo()
  pair(dir, '.config/fleet/x.mts', 'export const a = 1\n', 'export const a = 1\n')
  assert.equal(isUncascaded(dir, 'template/.config/fleet/x.mts'), false)
})

test('differing twin IS flagged', () => {
  const dir = makeRepo()
  pair(dir, '.config/fleet/x.mts', 'export const a = 2\n', 'export const a = 1\n')
  assert.equal(isUncascaded(dir, 'template/.config/fleet/x.mts'), true)
})

test('new template file with no twin IS flagged', () => {
  const dir = makeRepo()
  pair(dir, '.claude/hooks/fleet/new-guard/index.mts', 'x\n')
  assert.equal(
    isUncascaded(dir, 'template/.claude/hooks/fleet/new-guard/index.mts'),
    true,
  )
})

test('CLAUDE.md compared by fleet block only — preamble drift is NOT flagged', () => {
  const dir = makeRepo()
  const block = '<!-- BEGIN FLEET-CANONICAL -->\nR\n<!-- END FLEET-CANONICAL -->'
  pair(
    dir,
    'CLAUDE.md',
    `# template preamble\n${block}\npostamble A\n`,
    `# DIFFERENT repo preamble\n${block}\npostamble B\n`,
  )
  // Only preamble/postamble differ; the fleet block matches → not flagged.
  assert.equal(isUncascaded(dir, 'template/CLAUDE.md'), false)
})

test('CLAUDE.md fleet-block drift IS flagged', () => {
  const dir = makeRepo()
  pair(
    dir,
    'CLAUDE.md',
    'pre\n<!-- BEGIN FLEET-CANONICAL -->\nNEW RULE\n<!-- END FLEET-CANONICAL -->\n',
    'pre\n<!-- BEGIN FLEET-CANONICAL -->\nOLD RULE\n<!-- END FLEET-CANONICAL -->\n',
  )
  assert.equal(isUncascaded(dir, 'template/CLAUDE.md'), true)
})

test('settings.json is a merge target — byte difference is NOT flagged', () => {
  // The dogfood settings.json merges template fleet hooks with repo-tier hook
  // declarations, so it legitimately has extra .claude/hooks/repo/* entries the
  // template never carries. The cascade's settings_merge_drift check owns its
  // sync; this hook must not false-fire on the merge delta.
  const dir = makeRepo()
  mkdirSync(path.join(dir, '.claude'), { recursive: true })
  pair(
    dir,
    '.claude/settings.json',
    '{ "hooks": { "PreToolUse": ["fleet-a"] } }\n',
    '{ "hooks": { "PreToolUse": ["fleet-a", "repo-only-b"] } }\n',
  )
  assert.equal(isUncascaded(dir, 'template/.claude/settings.json'), false)
})
