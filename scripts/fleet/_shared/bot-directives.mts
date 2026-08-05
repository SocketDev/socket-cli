/**
 * @file Law-as-data: the review-bot DIRECTIVE surface — the comment commands
 *   that drive a bot's own PR machinery, verified against each bot's official
 *   docs, never guessed. Exists because our credentials can lack write on a
 *   repo we are reviewing (an external PR, a fork) while the review bot itself
 *   always has permission to act on its OWN comments and PRs. Verified live:
 *   `minimizeComment` returned FORBIDDEN for every local credential on an
 *   external PR, and posting `@coderabbitai resolve` still resolved and
 *   collapsed CodeRabbit's own review threads — the bot is the write path
 *   when we are not.
 *   `directiveFor(botLogin, intent)` is the lookup every consumer (the
 *   bot-comment-collapse-guard message, any future hook) uses instead of
 *   inlining a bot's command string, so a command spelling has exactly one
 *   place it can drift from the bot's real, current docs.
 *   A bot with no verified command surface (Renovate, GitHub Copilot code
 *   review) gets an entry that says so via `note` — never an invented
 *   command. Each entry cites the doc `source` it was verified against;
 *   re-verify there before editing a command string.
 */

export type BotDirectiveIntent =
  | 'close'
  | 'full-review'
  | 'ignore-dependency'
  | 'merge'
  | 'rebase'
  | 'recreate'
  | 'resolve-own-comments'
  | 'rerun-review'

export interface BotDirective {
  readonly command: string
  readonly why: string
}

export interface BotDirectiveEntry {
  readonly directives: Readonly<
    Partial<Record<BotDirectiveIntent, BotDirective>>
  >
  readonly login: string
  readonly note?: string | undefined
  readonly source: string
}

// Keyed by the bare login (lowercase, no `[bot]` suffix) — the same
// normalization bot-comment-collapse-guard's BOT_LOGIN_SET uses.
export const BOT_DIRECTIVES: Readonly<Record<string, BotDirectiveEntry>> = {
  coderabbitai: {
    directives: {
      'full-review': {
        command: '@coderabbitai full review',
        why: 're-reviews the whole PR from scratch, ignoring every prior comment — use after a rebase or a large rewrite invalidates the incremental history.',
      },
      'resolve-own-comments': {
        command: '@coderabbitai resolve',
        why: 'the no-write-permission lane — CodeRabbit resolves and collapses its OWN review threads and comments even when every local credential gets FORBIDDEN on minimizeComment.',
      },
      'rerun-review': {
        command: '@coderabbitai review',
        why: 'runs an incremental review of the changes since the last review, without re-walking the whole diff.',
      },
    },
    login: 'coderabbitai',
    source: 'https://docs.coderabbit.ai/guides/commands',
  },
  copilot: {
    directives: {},
    login: 'copilot',
    note: 'No comment-command surface is documented. A review is requested via the PR UI "Request" button next to Copilot under Reviewers, the REST API (request copilot-pull-request-reviewer[bot] as a reviewer), or `gh pr edit <PR> --add-reviewer copilot` — never a directive comment.',
    source:
      'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review',
  },
  dependabot: {
    directives: {
      close: {
        command: '@dependabot close',
        why: 'closes the PR and stops Dependabot recreating it for that update.',
      },
      'ignore-dependency': {
        command: '@dependabot ignore this dependency',
        why: 'closes the PR and stops Dependabot opening any future PR for this dependency.',
      },
      merge: {
        command: '@dependabot merge',
        why: 'merges the PR once CI passes, without needing our own merge permission.',
      },
      rebase: {
        command: '@dependabot rebase',
        why: 'rebases the PR onto the base branch to resolve conflicts, without recreating it.',
      },
      recreate: {
        command: '@dependabot recreate',
        why: 'recreates the PR from scratch, overwriting any manual edits — use when a rebase alone will not clear the conflict.',
      },
    },
    login: 'dependabot',
    source:
      'https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands',
  },
  renovate: {
    directives: {},
    login: 'renovate',
    note: 'No @mention comment-command surface exists — Renovate\'s maintainers declined the feature request in favor of a deliberate non-comment control: tick the "rebase/retry" checkbox in the PR body, or add a `rebase` label to the PR.',
    source: 'https://docs.renovatebot.com/updating-rebasing/',
  },
}

/**
 * The verified directive for `botLogin`'s `intent`, or `undefined` when the
 * bot has no entry, or has an entry but no verified command for that intent
 * (Renovate/Copilot's note-only entries, or an intent a bot simply does not
 * support).
 */
export function directiveFor(
  botLogin: string,
  intent: BotDirectiveIntent,
): BotDirective | undefined {
  const normalized = botLogin.toLowerCase().replace(/\[bot\]$/, '')
  return BOT_DIRECTIVES[normalized]?.directives[intent]
}
