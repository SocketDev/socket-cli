/**
 * @file Shared contract for the team-activity monitor. Every stage — config
 *   load, GitHub discovery, follow-up scan, state diff, render — agrees on
 *   these types, so a new field is one edit and the discriminated shapes stay
 *   honest. No org-specific identifiers appear in any type; those are config or
 *   runtime values, keeping the engine publish-safe and fleet-cascadable.
 */

// A GitHub item kind the monitor surfaces. Both flow through one discovery path
// (`search/issues` returns issues and PRs; `pull_request` presence splits them).
export type ItemKind = 'issue' | 'pr'

// One discovered open item (PR or issue), after roster/label/bot filtering and
// the bounded review-state fetch. `reason` is the one-line "why it's surfaced".
export interface ActivityItem {
  readonly author: string
  readonly createdAt: string
  readonly kind: ItemKind
  readonly labels: readonly string[]
  readonly number: number
  readonly reason: string
  readonly repo: string
  readonly title: string
  readonly updatedAt: string
  readonly url: string
}

// A review comment thread the monitor watches for new replies + reactions.
export interface WatchedComment {
  readonly commentId: number
  readonly pr: number
  readonly repo?: string | undefined
}

// Who a reply's author is relative to the watched conversation. The reply
// surfaces for engagement ONLY when it addresses the self-login's own comments;
// a thread between the PR author and another reviewer is theirs, not ours.
export type CommentAuthorRole = 'other' | 'pr-author' | 'team'

export interface CommentActivity {
  readonly author: string
  readonly body: string
  readonly createdAt: string
  readonly pr: number
  readonly quotedFrom: string | undefined
  readonly repo: string
  readonly role: CommentAuthorRole
}

// Optional Linear matching/enrichment (Phase 4). Unused until enabled.
export interface LinearConfig {
  readonly deriveRoster: boolean
  readonly enrich: boolean
  readonly linearToGithub: Readonly<Record<string, string>>
  readonly team: string
}

// Optional Slack read + quiet notify (Phase 5). Unused until enabled.
export interface SlackConfig {
  readonly channel: string
  readonly notifyStyle: 'reaction' | 'reply'
  readonly read: boolean
}

// Publish-safe monitor config. Org, repos, roster, labels, and channel are all
// supplied by the operator's config file; nothing org-specific is embedded.
export interface TeamActivityConfig {
  readonly authors: readonly string[]
  readonly dupPairs: ReadonlyArray<readonly number[]>
  readonly githubTeamSlug: string | undefined
  readonly includeIssues: boolean
  readonly labels: readonly string[]
  readonly linear: LinearConfig | undefined
  readonly name: string
  readonly org: string
  readonly repos: readonly string[]
  readonly selfLogin: string
  readonly skipBots: boolean
  readonly slack: SlackConfig | undefined
  readonly staleAfterDays: number | undefined
  readonly watchedComments: readonly WatchedComment[]
}

// Script-owned scan state (sibling `<config>.state.json`). `scannedAt` drives
// the incremental `updated:>=` discovery window; `reactions` memoizes per-watch
// reaction totals so "new" means since the previous tick.
export interface ScanState {
  reactions: Record<string, number>
  scannedAt: string
}

// The output of one scan pass. `newItems` are open items needing a human look;
// the rest carry the follow-up signals (replies, reactions, dup movement) and a
// loud error list (an empty-but-errored report must never read as all-quiet).
export interface ScanReport {
  readonly closedDups: string[]
  readonly errors: string[]
  readonly newItems: ActivityItem[]
  readonly reactionChanges: string[]
  readonly replies: CommentActivity[]
}

// Injectable gh runner: takes argv, returns stdout or `undefined` on non-zero.
// The seam that keeps the engine deterministic and unit-testable without spawn.
export interface GhRunner {
  (args: string[]): string | undefined
}
