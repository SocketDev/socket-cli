// node --test specs for ai-config-drift-reminder's pure parsers.

import test from 'node:test'
import assert from 'node:assert/strict'

import { isAiConfigPath, parseAiConfigDrift } from '../index.mts'

test('isAiConfigPath matches each AI-config dir at any depth', () => {
  assert.ok(isAiConfigPath('.claude/settings.json'))
  assert.ok(isAiConfigPath('.cursor/rules'))
  assert.ok(isAiConfigPath('.gemini/config'))
  assert.ok(isAiConfigPath('.vscode/settings.json'))
  assert.ok(isAiConfigPath('packages/foo/.cursor/rules'))
})

test('isAiConfigPath ignores ordinary paths', () => {
  assert.ok(!isAiConfigPath('src/index.ts'))
  assert.ok(!isAiConfigPath('README.md'))
  // A substring, not a path segment, must not match.
  assert.ok(!isAiConfigPath('docs/my.cursor.notes.md'))
})

test('parseAiConfigDrift selects only AI-config porcelain entries', () => {
  const porcelain = [
    ' M src/index.ts',
    '?? .cursor/rules',
    ' M .claude/settings.json',
    '?? notes.txt',
  ].join('\n')
  const drift = parseAiConfigDrift(porcelain)
  assert.deepEqual(
    drift.map(d => d.path),
    ['.cursor/rules', '.claude/settings.json'],
  )
})

test('parseAiConfigDrift handles renames (-> target)', () => {
  const drift = parseAiConfigDrift('R  old.txt -> .vscode/settings.json')
  assert.deepEqual(
    drift.map(d => d.path),
    ['.vscode/settings.json'],
  )
})

test('parseAiConfigDrift returns empty for a clean tree', () => {
  assert.deepEqual(parseAiConfigDrift(''), [])
  assert.deepEqual(parseAiConfigDrift(' M src/a.ts\n?? b.ts'), [])
})

test('parseAiConfigDrift preserves the status code', () => {
  const drift = parseAiConfigDrift('?? .gemini/config')
  assert.strictEqual(drift[0]!.status, '??')
  assert.strictEqual(drift[0]!.path, '.gemini/config')
})
