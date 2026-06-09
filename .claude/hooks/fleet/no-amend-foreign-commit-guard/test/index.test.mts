/**
 * @file Unit tests for no-amend-foreign-commit-guard. Drives the pure
 *   `isAmendCommit` + `shouldBlockAmend` directly (no live git) — both arms.
 */

import { describe, expect, it } from 'vitest'

import { isAmendCommit, shouldBlockAmend } from '../index.mts'

import type { AmendHeadInfo } from '../index.mts'

const NOW = 1_700_000_000_000

describe('no-amend-foreign-commit-guard isAmendCommit', () => {
  it('detects a git commit --amend', () => {
    expect(isAmendCommit('git commit --amend --no-edit')).toBe(true)
    expect(isAmendCommit('cd /repo && git commit --amend -m x')).toBe(true)
  })
  it('does not flag a plain commit or unrelated --amend mention', () => {
    expect(isAmendCommit('git commit -m "feat: x"')).toBe(false)
    expect(isAmendCommit('echo "use --amend carefully"')).toBe(false)
    expect(isAmendCommit('git log --amend')).toBe(false) // no `commit` token
  })
})

describe('no-amend-foreign-commit-guard shouldBlockAmend', () => {
  it("BLOCKS: ahead-of-remote + old tip (a parallel session's commit)", () => {
    const info: AmendHeadInfo = {
      aheadOfRemote: 2,
      headCommitMs: NOW - 60 * 60 * 1000, // 1h old
    }
    const reason = shouldBlockAmend(info, NOW)
    expect(reason).toBeDefined()
    expect(reason).toContain('unpushed')
  })

  it('ALLOWS: ahead-of-remote but freshly authored (within 10 min)', () => {
    const info: AmendHeadInfo = {
      aheadOfRemote: 1,
      headCommitMs: NOW - 30 * 1000, // 30s old — made this turn
    }
    expect(shouldBlockAmend(info, NOW)).toBeUndefined()
  })

  it('ALLOWS: HEAD == remote tip (not ahead — a force-push concern, not foreign)', () => {
    const info: AmendHeadInfo = {
      aheadOfRemote: 0,
      headCommitMs: NOW - 60 * 60 * 1000,
    }
    expect(shouldBlockAmend(info, NOW)).toBeUndefined()
  })

  it('ALLOWS: unreadable head timestamp (fail-open)', () => {
    expect(
      shouldBlockAmend({ aheadOfRemote: 2, headCommitMs: undefined }, NOW),
    ).toBeUndefined()
  })

  it('boundary: exactly at the fresh threshold is allowed; just past it blocks', () => {
    const FRESH = 10 * 60 * 1000
    expect(
      shouldBlockAmend({ aheadOfRemote: 1, headCommitMs: NOW - FRESH }, NOW),
    ).toBeUndefined()
    expect(
      shouldBlockAmend(
        { aheadOfRemote: 1, headCommitMs: NOW - FRESH - 1000 },
        NOW,
      ),
    ).toBeDefined()
  })
})
