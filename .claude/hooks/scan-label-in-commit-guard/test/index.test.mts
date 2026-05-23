/**
 * @file Unit tests for findScanLabels + extractCommitMessage.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { extractCommitMessage, findScanLabels } from '../index.mts'

// ── findScanLabels ──

test('flags single B-label in prose', () => {
  const hits = findScanLabels('fix(http): B5 download truncation race')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'B5')
})

test('flags multiple labels across lines', () => {
  const body = `fix(security): land B1 + M9 fixes

Also addresses H3 (rc file mode).`
  const hits = findScanLabels(body)
  assert.equal(hits.length, 3)
  const labels = hits.map(h => h.label).toSorted()
  assert.deepEqual(labels, ['B1', 'H3', 'M9'])
})

test('does not flag lowercase', () => {
  const hits = findScanLabels('fix b1 bug')
  assert.equal(hits.length, 0)
})

test('does not flag 5+ digit IDs', () => {
  const hits = findScanLabels('Refs B12345 (a real internal ID)')
  assert.equal(hits.length, 0)
})

test('does not flag GHSA-style identifiers', () => {
  const hits = findScanLabels('Bump for GHSA-B1-xyz advisory')
  assert.equal(hits.length, 0)
})

test('does not flag inside fenced code block', () => {
  const body = `chore: pin pnpm

Output for reference:
\`\`\`
B1 = expected
M9 = expected
\`\`\`

No real labels here.`
  const hits = findScanLabels(body)
  assert.equal(hits.length, 0)
})

test('flags label before fenced block', () => {
  const body = `fix B5 issue

\`\`\`
log content
\`\`\``
  const hits = findScanLabels(body)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'B5')
})

test('flags label after fenced block', () => {
  const body = `\`\`\`
output
\`\`\`

Closes M3.`
  const hits = findScanLabels(body)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'M3')
})

test('deduplicates same label same line', () => {
  // Same label twice on one line dedups to a single hit (the dedup key
  // is `${line}:${label}` so the operator gets one entry per offending
  // line, not one per character offset).
  const hits = findScanLabels('fix B1 and B1 again')
  assert.equal(hits.length, 1)
})

// ── extractCommitMessage ──

test('extracts -m "msg"', () => {
  const msg = extractCommitMessage('git commit -m "fix B5 issue"', '/tmp')
  assert.equal(msg, 'fix B5 issue')
})

test("extracts -m 'msg' (single quotes)", () => {
  const msg = extractCommitMessage("git commit -m 'fix M9 issue'", '/tmp')
  assert.equal(msg, 'fix M9 issue')
})

test('extracts --message=msg', () => {
  const msg = extractCommitMessage(
    'git commit --message="addresses H3"',
    '/tmp',
  )
  assert.equal(msg, 'addresses H3')
})

test('returns undefined for non-commit command', () => {
  assert.equal(extractCommitMessage('git push origin main', '/tmp'), undefined)
  assert.equal(extractCommitMessage('ls -la', '/tmp'), undefined)
})

test('returns undefined for `git commit` with no -m/-F (editor mode)', () => {
  assert.equal(extractCommitMessage('git commit', '/tmp'), undefined)
  assert.equal(extractCommitMessage('git commit --amend', '/tmp'), undefined)
})

test('extracts -F file content', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-msg-test-'))
  try {
    const file = path.join(dir, 'msg.txt')
    writeFileSync(file, 'fix(http): B5 + M9 issues')
    const msg = extractCommitMessage(`git commit -F ${file}`, dir)
    assert.equal(msg, 'fix(http): B5 + M9 issues')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('extracts --file= file content', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-msg-test-'))
  try {
    const file = path.join(dir, 'msg.txt')
    writeFileSync(file, 'fix L7')
    const msg = extractCommitMessage(`git commit --file=${file}`, dir)
    assert.equal(msg, 'fix L7')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('returns undefined if -F file does not exist', () => {
  const msg = extractCommitMessage(
    'git commit -F /nonexistent-path-for-test',
    '/tmp',
  )
  assert.equal(msg, undefined)
})

test('multiple -m flags concatenate', () => {
  const msg = extractCommitMessage(
    'git commit -m "title B1" -m "body M9"',
    '/tmp',
  )
  assert.match(msg!, /B1/)
  assert.match(msg!, /M9/)
})
