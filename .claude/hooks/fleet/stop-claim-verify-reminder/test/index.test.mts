/**
 * @file Unit tests for findUnbackedClaims — the pure core that flags a success
 *   self-claim with no backing tool call this session.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findUnbackedClaims } from '../../_shared/unbacked-claims.mts'

// ── unbacked claim → hit ────────────────────────────────────────

test('"tests pass" with no test command run → hit', () => {
  const hits = findUnbackedClaims('Done — all tests pass now.', [
    'git status',
    'cat README.md',
  ])
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'tests pass')
})

test('"the build succeeds" with no build run → hit', () => {
  const hits = findUnbackedClaims('The build succeeds cleanly.', ['ls'])
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'build succeeds')
})

test('"lint is clean" with no lint run → hit', () => {
  const hits = findUnbackedClaims('Lint is clean.', ['git diff'])
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'lint passes')
})

test('"verified the popup" with no render run → hit', () => {
  const hits = findUnbackedClaims('Verified the popup looks correct.', [
    'pnpm run build',
    'pnpm run check',
  ])
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'render verified')
})

test('a build/bundle success does NOT back a render claim → hit', () => {
  // The exact failure mode this rule exists for: claiming the UI is verified
  // on the strength of a green build, with no actual render this session.
  const hits = findUnbackedClaims('The build succeeds, so the UI renders correctly.', [
    'pnpm run build',
  ])
  const renderHit = hits.find(h => h.label === 'render verified')
  assert.ok(renderHit, 'expected a render-verified hit')
})

// ── backed claim → no hit ───────────────────────────────────────

test('"tests pass" backed by a vitest run → no hit', () => {
  const hits = findUnbackedClaims('All tests pass.', [
    'node_modules/.bin/vitest run test/unit/foo.test.mts',
  ])
  assert.equal(hits.length, 0)
})

test('"tests pass" backed by `pnpm test` → no hit', () => {
  const hits = findUnbackedClaims('Tests passing.', ['pnpm test'])
  assert.equal(hits.length, 0)
})

test('"typechecks" backed by tsgo → no hit', () => {
  const hits = findUnbackedClaims('It typechecks, no type errors.', [
    'node_modules/.bin/tsgo --noEmit -p tsconfig.check.json',
  ])
  assert.equal(hits.length, 0)
})

test('"lint passes" backed by `pnpm run check` → no hit', () => {
  const hits = findUnbackedClaims('Lint passes.', ['pnpm run check --all'])
  assert.equal(hits.length, 0)
})

test('render claim backed by a screenshot render → no hit', () => {
  const hits = findUnbackedClaims('Verified the popup renders correctly.', [
    'node .claude/skills/fleet/rendering-chromium-to-png/screenshot.mts file://popup.html?preview --out p.png',
  ])
  assert.equal(hits.length, 0)
})

// ── no claim → no hit ───────────────────────────────────────────

test('prose with no success claim → no hit', () => {
  const hits = findUnbackedClaims(
    'I edited the file and will run the tests next.',
    [],
  )
  assert.equal(hits.length, 0)
})

// ── claim inside a code fence is ignored ────────────────────────

test('a claim inside a code fence is not flagged', () => {
  const text = ['Example output:', '```', 'tests pass (42)', '```'].join('\n')
  const hits = findUnbackedClaims(text, [])
  assert.equal(hits.length, 0)
})

// ── multiple categories ─────────────────────────────────────────

test('two unbacked claims → two hits', () => {
  const hits = findUnbackedClaims('Tests pass and the build succeeds.', [
    'git commit -m x',
  ])
  assert.equal(hits.length, 2)
})
