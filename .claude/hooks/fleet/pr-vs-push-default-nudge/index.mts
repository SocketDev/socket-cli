#!/usr/bin/env node
// Claude Code PreToolUse hook — pr-vs-push-default-nudge.
//
// Reminder (NOT a block) on `gh pr create` invocations when the recent
// transcript doesn't carry an explicit PR directive ("open a PR", "PR
// this", "make a PR", "pull request").
//
// Per CLAUDE.md "Push policy: push, fall back to PR" — direct push is
// the fleet default; PR is the explicit opt-in. The reminder surfaces
// when the agent is about to open a PR without user-asked-for-PR
// signal, in case a push would actually work and a PR is wasted work
// (the user will then have to close the PR).
//
// Fires in two cases:
//   1. On main/master in ANY repo — try `git push origin <branch>` first.
//   2. On a FEATURE branch in a FLEET repo — the right move is usually
//      `git push origin <branch>:main` (the commits go straight to main),
//      NOT a PR. This is the case that bit a session 2026-06-02: the agent
//      ASSUMED socket-lib was PR-only from commit history + GitHub's
//      "create a PR" hint, cut a feature branch, and nearly opened a PR —
//      a direct push to main worked immediately. The old hook skipped
//      every non-main branch, so it never caught that assumption.
//
// Non-fleet feature branches are left alone (PR is the right default for
// repos outside the fleet, e.g. firewall).

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readFileSync } from 'node:fs'

import { isFleetRepo, originSlug } from '../_shared/fleet-repos.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

import type { Command } from '../_shared/shell-command.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

// Patterns that signal "I want a PR." Match against the FULL trimmed
// text of any of the last N user turns.
const PR_DIRECTIVE_PATTERNS = [
  /\bopen (?:a |the )?pr\b/i,
  /\bpr this\b/i,
  /\bmake (?:a |the )?pr\b/i,
  /\bcreate (?:a |the )?pr\b/i,
  /\bsend (?:a |the )?pr\b/i,
  /\bpull request\b/i,
]

// Recent user-turn window.
const TURN_WINDOW = 6

export function currentBranch(cwd: string): string | undefined {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout).trim()
}

export function hasPrDirective(turns: string[]): boolean {
  for (let i = 0, { length } = turns; i < length; i += 1) {
    const text = turns[i]!
    for (let j = 0, { length: len } = PR_DIRECTIVE_PATTERNS; j < len; j += 1) {
      const re = PR_DIRECTIVE_PATTERNS[j]!
      if (re.test(text)) {
        return true
      }
    }
  }
  return false
}

// All of these reason about COMMAND STRUCTURE (binary + subcommand verb +
// flags + refspec args), so they go through the shell-quote-backed AST
// parser (parseCommands / commandsFor), NOT regex — per CLAUDE.md's
// "prefer AST-based parsing over regex in Bash-allowlist hooks". Regex
// would misread `&&` chains, quoting, `$(…)` substitution, and would
// false-positive on a literal "git push" inside a grep string.

// True when a parsed `gh` segment is a `pr create` / `pr new` (incl.
// `--web`). The verb is the first two non-flag args after the binary.
export function isGhPrCreate(command: string): boolean {
  return commandsFor(command, 'gh').some(c => isGhPrCreateCmd(c))
}

function isGhPrCreateCmd(c: Command): boolean {
  const verbs = c.args.filter(a => !a.startsWith('-'))
  return verbs[0] === 'pr' && (verbs[1] === 'create' || verbs[1] === 'new')
}

// Read a flag's value from parsed args, supporting `--base v`, `--base=v`,
// and the short `-B v`. Returns undefined when the flag is absent.
function flagValue(
  args: readonly string[],
  long: string,
  short?: string | undefined,
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === long || (short !== undefined && a === short)) {
      const next = args[i + 1]
      return next && !next.startsWith('-') ? next : undefined
    }
    if (a.startsWith(`${long}=`)) {
      return a.slice(long.length + 1)
    }
  }
  return undefined
}

// A targeted/stacked PR (`--base <non-default>`) is deliberate, not the
// accidental-PR-instead-of-push case → skip.
export function isTargetedBase(
  command: string,
  defaultBranch: string,
): boolean {
  for (const c of commandsFor(command, 'gh')) {
    if (!isGhPrCreateCmd(c)) {
      continue
    }
    const base = flagValue(c.args, '--base', '-B')
    if (base !== undefined && base !== defaultBranch) {
      return true
    }
  }
  return false
}

// Does a parsed `git push` refspec target the default branch? Refspecs
// look like `<src>:<dst>` or a bare `<branch>`; the dst (or the bare ref)
// is what lands on the remote. `HEAD:main`, `feat/x:main`, or a bare
// `main` all count as pushing TO the default branch.
function pushTargetsDefault(c: Command, defaultBranch: string): boolean {
  const refspecs = c.args.filter(
    a => !a.startsWith('-') && a !== 'push' && a !== 'origin',
  )
  for (let i = 0, { length } = refspecs; i < length; i += 1) {
    const ref = refspecs[i]!
    const dst = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref
    if (dst === defaultBranch) {
      return true
    }
  }
  return false
}

// A `git push` that pushes a feature branch AS a branch (the precursor to
// a PR): `git push -u origin feat/x`, `git push origin HEAD`, etc.
// Excludes a push whose refspec already targets the default branch (that
// IS the direct push we want) and excludes being on the default branch.
export function isFeatureBranchPush(
  command: string,
  branch: string,
  defaultBranch: string,
): boolean {
  if (branch === defaultBranch) {
    return false
  }
  for (const c of commandsFor(command, 'git')) {
    if (!c.args.includes('push')) {
      continue
    }
    if (pushTargetsDefault(c, defaultBranch)) {
      return false
    }
    return true
  }
  return false
}

// True when ANY git-push segment in the command targets the default
// branch — used to detect "already pushed to main this session".
export function commandPushesToDefault(
  command: string,
  defaultBranch: string,
): boolean {
  return commandsFor(command, 'git').some(
    c => c.args.includes('push') && pushTargetsDefault(c, defaultBranch),
  )
}

// Does an open PR already exist for this branch? If so, re-running
// gh pr create is intentional/idempotent — suppress the reminder.
export function hasOpenPrForBranch(cwd: string, branch: string): boolean {
  const r = spawnSync(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'],
    { cwd, timeout: 5000 /* win-timeout: network */ },
  )
  /* c8 ignore next - the false branch (status 0) requires live gh auth */
  if (r.status !== 0) {
    return false
  }
  /* c8 ignore start - requires live gh auth; subprocess can't be mocked here */
  const out = String(r.stdout).trim()
  // `[]` = none; any populated array = an open PR exists.
  return out.length > 0 && out !== '[]'
  /* c8 ignore stop */
}

// Resolve the repo's default branch from origin/HEAD. When that's
// unresolvable (no origin remote, or HEAD not set), fall back to the
// current branch IF it's itself a conventional default (main/master) —
// so a remote-less `master` checkout resolves `master`, not `main` — and
// otherwise to `main`. `currentBranchName` is optional so callers without
// it still get the main→… behavior.
export function defaultBranchOf(
  cwd: string,
  currentBranchName?: string | undefined,
): string {
  const r = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status === 0) {
    const ref = String(r.stdout)
      .trim()
      .replace(/^refs\/remotes\/origin\//, '')
    /* c8 ignore next - git symbolic-ref always emits a non-empty branch name; empty ref is a defensive fallback */
    if (ref) {
      return ref
    }
  }
  if (currentBranchName === 'main' || currentBranchName === 'master') {
    return currentBranchName
  }
  return 'main'
}

// Origin slug (owner/repo) for fleet-membership classification — the canonical
// impl lives in _shared/fleet-repos; re-exported here so this hook's test can
// import it from its own module.
export { originSlug }

// Did a push to the default branch already happen this session? Scans the
// recent transcript text lines for a git-push command targeting the
// default branch — parsed structurally (the same parser the live command
// uses), not regex-matched. A later PR-open is then likely confusion.
export function pushedToDefaultThisSession(
  textLines: string[],
  defaultBranch: string,
): boolean {
  for (let i = 0, { length } = textLines; i < length; i += 1) {
    if (commandPushesToDefault(textLines[i]!, defaultBranch)) {
      return true
    }
  }
  return false
}

interface TranscriptEntry {
  type?: string | undefined
  message?: { content?: unknown | undefined } | undefined
}

export function readRecentUserTurnTexts(
  transcriptPath: string,
  window: number,
): string[] {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }
  const turns: string[] = []
  const lineList = raw.split(/\r?\n/)
  for (let i = 0, { length } = lineList; i < length; i += 1) {
    const line = lineList[i]!
    if (!line.trim()) {
      continue
    }
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    if (entry.type !== 'user') {
      continue
    }
    const c = entry.message?.content
    if (typeof c === 'string') {
      turns.push(c)
    } else if (Array.isArray(c)) {
      turns.push(
        c
          .map(seg =>
            typeof seg === 'string'
              ? seg
              : typeof (seg as { text?: unknown | undefined }).text === 'string'
                ? (seg as { text: string }).text
                : '',
          )
          .join('\n'),
      )
    }
  }
  return turns.slice(-window)
}

export const hook = defineHook({
  check: bashGuard((command, payload) => {
    const isPrCreate = isGhPrCreate(command)
    // git-push detection via the parser (structural), not regex.
    const isPush = commandsFor(command, 'git').some(c =>
      c.args.includes('push'),
    )
    // Only PR-create or git-push commands are in scope.
    if (!isPrCreate && !isPush) {
      return undefined
    }

    const cwd = resolveProjectDir(payload.cwd)
    const branch = currentBranch(cwd)
    if (!branch) {
      return undefined
    }
    const defaultBranch = defaultBranchOf(cwd, branch)
    const onDefault = branch === defaultBranch

    // Explicit PR directive → the user asked for a PR; never warn.
    const turns = payload.transcript_path
      ? readRecentUserTurnTexts(payload.transcript_path, TURN_WINDOW)
      : []
    if (hasPrDirective(turns)) {
      return undefined
    }

    // Classify the repo. Feature-branch reminders only apply to FLEET
    // repos (direct-push-to-main is the fleet default); non-fleet repos
    // like firewall legitimately use PR-from-feature-branch flow.
    const slug = originSlug(cwd)
    const fleet = slug ? isFleetRepo(slug) : false

    // ---- git push handling ----
    if (isPush && !isPrCreate) {
      // A push straight to the default branch is exactly what we want.
      if (onDefault || !isFeatureBranchPush(command, branch, defaultBranch)) {
        return undefined
      }
      // Pushing a feature branch AS a branch in a fleet repo — the usual
      // right move is a direct push to the default branch instead.
      if (!fleet) {
        return undefined
      }
      return notify(
        [
          '[pr-vs-push-default-nudge] Pushing a feature branch in a fleet repo',
          '',
          /* c8 ignore start - slug is always defined here; fleet===true requires isFleetRepo(slug) which requires a non-null slug */
          `  Branch: ${branch}   Repo: ${slug ?? '(unknown)'}   Default: ${defaultBranch}`,
          /* c8 ignore stop */
          '  No explicit PR directive in recent turns.',
          '',
          '  Per CLAUDE.md "Push policy: push, fall back to PR" — for fleet',
          '  repos direct-push-to-main is the default. Pushing a feature',
          '  branch is usually the first step of an unnecessary PR.',
          '',
          '  Push straight to the default branch instead:',
          '',
          `    git push origin ${branch}:${defaultBranch}`,
          '',
          '  Fall back to a branch + PR only if that push is REJECTED. Do',
          '  not assume PR-only from commit history or GitHub hints — try',
          '  the direct push and let the server decide.',
          '',
          '  Reminder-only; not a block.',
          '',
        ].join('\n'),
      )
    }

    // ---- gh pr create handling ----
    // Targeted/stacked PR (--base non-default) is deliberate → skip.
    if (isTargetedBase(command, defaultBranch)) {
      return undefined
    }
    // An open PR already exists for this branch → re-running is intentional.
    /* c8 ignore next - hasOpenPrForBranch returns false without live gh auth */
    if (!onDefault && hasOpenPrForBranch(cwd, branch)) {
      return undefined
    }
    // On a non-default branch in a NON-fleet repo, a PR is the right default.
    if (!onDefault && !fleet) {
      return undefined
    }

    const alreadyPushedToDefault = pushedToDefaultThisSession(
      turns,
      defaultBranch,
    )
    const pushCmd = onDefault
      ? `git push origin ${branch}`
      : `git push origin ${branch}:${defaultBranch}`

    return notify(
      [
        onDefault
          ? '[pr-vs-push-default-nudge] About to open a PR from the default branch'
          : '[pr-vs-push-default-nudge] About to open a PR from a fleet feature branch',
        '',
        `  Branch: ${branch}   Repo: ${slug ?? '(unknown)'}   Default: ${defaultBranch}`,
        '  Recent user turns do not contain an explicit PR directive',
        '  ("open a PR", "PR this", "make a PR", "pull request").',
        ...(alreadyPushedToDefault
          ? [
              '',
              '  NOTE: a push to the default branch already happened this',
              '  session — opening a PR now is likely confusion.',
            ]
          : []),
        '',
        '  Per CLAUDE.md "Push policy: push, fall back to PR" — direct push',
        '  is the fleet default; a PR is the opt-in. A speculative PR makes',
        '  the user close it; that wastes their time.',
        '',
        '  Try the direct push first:',
        '',
        `    ${pushCmd}`,
        '',
        '  Fall back to `gh pr create` only when the push is REJECTED. Do',
        '  not assume PR-only from commit history or GitHub hints.',
        '',
        '  Reminder-only; not a block.',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
