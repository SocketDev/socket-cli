/**
 * @file Unit tests for no-amend-foreign-commit-guard. Drives the pure
 *   `isAmendCommit` + `shouldBlockAmend` directly (no live git) — both arms.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isAmendCommit, shouldBlockAmend } from '../index.mts'

import type { AmendHeadInfo } from '../index.mts'

const NOW = 1_700_000_000_000

describe('no-amend-foreign-commit-guard isAmendCommit', () => {
  it('detects a git commit --amend', () => {
    assert.strictEqual(isAmendCommit('git commit --amend --no-edit'), true)
    assert.strictEqual(isAmendCommit('cd /repo && git commit --amend -m x'), true)
  })
  it('does not flag a plain commit or unrelated --amend mention', () => {
    assert.strictEqual(isAmendCommit('git commit -m "feat: x"'), false)
    assert.strictEqual(isAmendCommit('echo "use --amend carefully"'), false)
    assert.strictEqual(isAmendCommit('git log --amend'), false) // no `commit` token
  })
})

describe('no-amend-foreign-commit-guard shouldBlockAmend', () => {
  it("BLOCKS: ahead-of-remote + old tip (a parallel session's commit)", () => {
    const info: AmendHeadInfo = {
      aheadOfRemote: 2,
      headCommitMs: NOW - 60 * 60 * 1000, // 1h old
    }
    const reason = shouldBlockAmend(info, NOW)
    assert.notStrictEqual(reason, undefined)
    assert.ok(reason!.includes('unpushed'))
  })

  it('ALLOWS: ahead-of-remote but freshly authored (within 10 min)', () => {
    const info: AmendHeadInfo = {
      aheadOfRemote: 1,
      headCommitMs: NOW - 30 * 1000, // 30s old — made this turn
    }
    assert.strictEqual(shouldBlockAmend(info, NOW), undefined)
  })

  it('ALLOWS: HEAD == remote tip (not ahead — a force-push concern, not foreign)', () => {
    const info: AmendHeadInfo = {
      aheadOfRemote: 0,
      headCommitMs: NOW - 60 * 60 * 1000,
    }
    assert.strictEqual(shouldBlockAmend(info, NOW), undefined)
  })

  it('ALLOWS: unreadable head timestamp (fail-open)', () => {
    assert.strictEqual(
      shouldBlockAmend({ aheadOfRemote: 2, headCommitMs: undefined }, NOW),
      undefined,
    )
  })

  it('boundary: exactly at the fresh threshold is allowed; just past it blocks', () => {
    const FRESH = 10 * 60 * 1000
    assert.strictEqual(
      shouldBlockAmend({ aheadOfRemote: 1, headCommitMs: NOW - FRESH }, NOW),
      undefined,
    )
    assert.notStrictEqual(
      shouldBlockAmend(
        { aheadOfRemote: 1, headCommitMs: NOW - FRESH - 1000 },
        NOW,
      ),
      undefined,
    )
  })
})
