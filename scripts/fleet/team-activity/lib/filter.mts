/**
 * @file Review-state assessment. Search rows say WHAT is open; they don't carry
 *   comments or review decisions, so each candidate gets one bounded `gh view`
 *   fetch to decide whether it still needs a human look. An item is surfaced
 *   when it is not a draft, no human (non-self, non-bot) has engaged, and the
 *   self-login has not engaged — the same convergence the old scanner used, now
 *   across PRs and issues. A fetch failure surfaces the item with a LOUD note
 *   plus a recorded error, never a silent drop.
 */

import { isBotLogin } from '../../lib/github-bots.mts'

import type { RawCandidate } from './discover.mts'
import type { ActivityItem, GhRunner, TeamActivityConfig } from './types.mts'

export interface AssessResult {
  readonly errors: string[]
  readonly items: ActivityItem[]
}

interface ReviewFacts {
  readonly commenters: readonly string[]
  readonly decision: string
  readonly reviewers: readonly string[]
}

function fetchReviewFacts(
  gh: GhRunner,
  candidate: RawCandidate,
): ReviewFacts | undefined {
  const target = [String(candidate.number), '--repo', candidate.repo]
  const out =
    candidate.kind === 'pr'
      ? gh([
          'pr',
          'view',
          ...target,
          '--json',
          'comments,reviews,reviewDecision',
          '--jq',
          '{commenters: [.comments[].author.login], reviewers: [.reviews[].author.login], decision: (.reviewDecision // "")}',
        ])
      : gh([
          'issue',
          'view',
          ...target,
          '--json',
          'comments',
          '--jq',
          '{commenters: [.comments[].author.login], reviewers: [], decision: ""}',
        ])
  if (out === undefined) {
    return undefined
  }
  try {
    const parsed = JSON.parse(out) as {
      commenters?: string[] | undefined
      decision?: string | undefined
      reviewers?: string[] | undefined
    }
    return {
      commenters: parsed.commenters ?? [],
      decision: parsed.decision ?? '',
      reviewers: parsed.reviewers ?? [],
    }
  } catch {
    return undefined
  }
}

// True when someone other than the self-login and not a bot has engaged.
function humanEngaged(
  logins: readonly string[],
  selfLogin: string,
  options: { skipBots: boolean },
): boolean {
  const { skipBots } = options
  return logins.some(
    login => login !== selfLogin && !(skipBots && isBotLogin(login)),
  )
}

function reasonFor(candidate: RawCandidate, decision: string): string {
  if (candidate.kind === 'issue') {
    return 'open, no response yet'
  }
  return decision === 'REVIEW_REQUIRED'
    ? 'open, review required, no human has looked yet'
    : 'open, no human review yet'
}

// Assess every candidate. Returns the items that need a human look plus a loud
// error list. Drafts and already-engaged items are dropped; a candidate whose
// review state could not be fetched is surfaced with a note (never silently
// dropped).
export function assessItems(
  candidates: readonly RawCandidate[],
  gh: GhRunner,
  config: TeamActivityConfig,
): AssessResult {
  const errors: string[] = []
  const items: ActivityItem[] = []
  for (const candidate of candidates) {
    if (candidate.kind === 'pr' && candidate.draft) {
      continue
    }
    const facts = fetchReviewFacts(gh, candidate)
    if (facts === undefined) {
      errors.push(
        `${candidate.repo}#${candidate.number}: review-state fetch failed`,
      )
      items.push({
        author: candidate.author,
        createdAt: candidate.createdAt,
        kind: candidate.kind,
        labels: candidate.labels,
        number: candidate.number,
        reason: 'open (review state could not be fetched — verify manually)',
        repo: candidate.repo,
        title: candidate.title,
        updatedAt: candidate.updatedAt,
        url: candidate.url,
      })
      continue
    }
    const engagement = [...facts.commenters, ...facts.reviewers]
    if (engagement.includes(config.selfLogin)) {
      continue
    }
    if (
      humanEngaged(engagement, config.selfLogin, { skipBots: config.skipBots })
    ) {
      continue
    }
    items.push({
      author: candidate.author,
      createdAt: candidate.createdAt,
      kind: candidate.kind,
      labels: candidate.labels,
      number: candidate.number,
      reason: reasonFor(candidate, facts.decision),
      repo: candidate.repo,
      title: candidate.title,
      updatedAt: candidate.updatedAt,
      url: candidate.url,
    })
  }
  return { errors, items }
}
