#!/usr/bin/env node
// Claude Code PreToolUse hook — no-revert-guard.
//
// Blocks Bash commands that would revert tracked changes, bypass the
// git-hook chain (.git-hooks/ wired in via `core.hooksPath`), or
// otherwise destroy work in flight, unless the conversation has
// authorized the bypass via the canonical phrase
// `Allow <X> bypass`, case-sensitive, exact match.
//
// The bypass-phrase contract:
//   - Work loss (git checkout/clean/reset --hard/restore/rm/stash
//       drop|pop|clear) → user must type "Allow revert bypass" in a recent
//       user turn. The covered shapes, the derived rule label, and why
//       `git revert` is NOT one of them: `destructive-git-shapes.mts`.
//   - Hook bypass (--no-verify, --no-gpg-sign) →
//       user must type "Allow <X> bypass" where <X> matches the flag
//       (e.g. "Allow no-verify bypass", "Allow gpg bypass").
//   - Hook-chain redirection (`-c core.hooksPath=…`, `--config-env`, the
//       `GIT_CONFIG_KEY_<i>` env form) → same "Allow no-verify bypass"
//       phrase, since it is the same decision with the HUSKY=0 blast
//       radius. Detector + the foreign-repo carve-out: `hooks-path.mts`.
//
// Force-push (--force / -f / --force-with-lease / --force-if-includes) is
// its own guard: `.claude/hooks/fleet/no-force-push-guard/`.
//
// Phrase scoping: the hook reads the recent user turns from the
// transcript, most recent N user messages. A phrase from a prior
// session does NOT carry over — only the current conversation counts.
//
// Why a hook + a memory + a CLAUDE.md rule: the rule documents the
// policy, the memory keeps the assistant honest across sessions, the
// hook is the actual enforcement at edit time. When Claude tries the
// destructive command, this hook checks the transcript, finds no
// matching authorization phrase, and exits 2 with a stderr message
// telling Claude exactly what the user needs to type. The user then
// makes a deliberate choice instead of Claude inferring intent.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }
//
// Fails open on hook bugs (exit 0 + stderr log).

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { currentBranch, gitOut } from '../_shared/git-branch.mts'
import { isReadOnlyStashAction } from '../_shared/git-stash.mts'
import {
  gitSubcommandReadings,
  splitGitSubcommand,
} from '../_shared/git-subcommand.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor, isFleetSyncCommand } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { operatorBypassPresent } from '../_shared/transcript.mts'
import {
  DESTRUCTIVE_GIT_RULE_LABEL,
  destructiveGitShape,
} from './destructive-git-shapes.mts'
import { matchHooksPathSkip } from './hooks-path.mts'
import { resolveDestructiveGitRepoRoot } from './target-repo.mts'

type RevertCheck = {
  // Canonical phrase the user must type to bypass.
  readonly bypassPhrase: string
  // True for FLEET-CONVENTION checks — ones that protect the fleet's own
  // process (the `.git-hooks/` chain, fleet commit-signing, the parallel-Claude
  // checkout rule, the fleet Edit-layer hooks). Those are meaningless in a
  // non-fleet repo, so they no-op there (gated on `isFleetTarget`). Omit (the
  // default) for the UNIVERSAL WORK-LOSS check (revert) — destroying tracked
  // work is hazardous in ANY repo, so it fires everywhere. Matches the
  // fleet-context doctrine: convention guards gate, safety doesn't.
  readonly fleetOnly?: boolean | undefined
  // Human-readable label for the rule, logged on rejection.
  readonly label: string
  // Detector. Exactly one of `pattern` / `matches` is set:
  //   - `pattern`: a regex matched anywhere in the command. Correct for
  //     flag rules (`--no-verify`, `--no-gpg-sign`) that apply
  //     regardless of which binary they sit on.
  //   - `matches`: a parser-based detector for command-STRUCTURE rules
  //     which git subcommand runs. Returns the offending substring for
  //     the log, or undefined when no match. Sees through chains / `$(…)`
  //     / quotes, where a regex would over- or under-match. The payload is
  //     passed so a detector can resolve WHICH repo the command targets.
  readonly pattern?: RegExp | undefined
  readonly matches?: (
    command: string,
    payload: ToolCallPayload,
  ) => string | undefined
}

// Pre-flight triggers: the dispatcher imports + runs this guard only when the
// raw command contains at least one of these substrings. Every blocking branch
// requires one verbatim:
//   - all git-structure checks (checkout/restore/reset/stash/clean/rm,
//     bare-stash) go through `commandsFor(command, 'git')`, which
//     short-circuits unless the line contains `git`.
//   - the --no-verify check is gated by a `--no-verify` regex.
//   - the core.hooksPath check needs a real `git` segment running a
//     hook-running subcommand, so the `git` trigger already covers every
//     spelling of it (`-c`, `--config-env`, `GIT_CONFIG_KEY_<i>`).
//   - the gpg check matches `--no-gpg-sign` or `commit.gpgsign`.
//   - SKIP_ASSET_DOWNLOAD is its own literal.
//   - bash-write alternates over python / sed / cat (heredoc) / tee / dd.
// Keep COMPLETE: a missing trigger would silently skip the guard for a case it
// should block. Broad short tokens (`dd`, `tee`, `cat`, `sed`) are fine — over-
// triggering only re-runs the guard, status quo, it never disables it.
export const triggers: readonly string[] = [
  '--no-gpg-sign',
  '--no-verify',
  'HUSKY',
  'SKIP_ASSET_DOWNLOAD',
  'cat',
  'commit.gpgsign',
  'dd',
  'git',
  'python',
  'sed',
  'tee',
]

const CHECKS: readonly RevertCheck[] = [
  {
    bypassPhrase: 'Allow revert bypass',
    // Derived from the covered subcommand list, so the label can never name an
    // operation the matcher misses (or miss one it covers) —
    // `destructive-git-shapes.mts` also records why `git revert` is absent.
    label: DESTRUCTIVE_GIT_RULE_LABEL,
    // Parser-based: inspect each real `git` command's args for a
    // destructive subcommand shape. Sees through chains / quotes so a
    // quoted "git reset --hard" in a commit message isn't a match.
    matches: command => matchDestructiveGit(command),
  },
  {
    bypassPhrase: 'Allow no-verify bypass',
    fleetOnly: true,
    label: 'git --no-verify (skips .git-hooks/ chain)',
    // `git rebase --no-verify` is exempt: rebase replays existing commits
    // already-passed hooks, and the pre-commit chain would re-run hooks
    // on every replay, which both wastes work and can mutate content
    // mid-rewrite (autofix → diverged commit). The block stays for
    // `git commit --no-verify` and `git push --no-verify`, which is
    // where the policy's actual risk lives.
    matches: command => matchNoVerify(command),
  },
  {
    bypassPhrase: 'Allow gpg bypass',
    fleetOnly: true,
    label: 'git --no-gpg-sign / commit.gpgsign=false',
    pattern: /(?:--no-gpg-sign|commit\.gpgsign\s*=\s*false)\b/,
  },
  {
    // HUSKY=0 is the heavier --no-verify: one inline assignment skips the
    // WHOLE .git-hooks/ chain for the invocation (every hook type, including
    // post-commit, which --no-verify can't reach). Same phrase as --no-verify
    // because it is the same policy decision with a wider blast radius. No
    // rebase carve-out: a rebase replay wanting hooks off uses the already-
    // exempt `git rebase --no-verify` form.
    bypassPhrase: 'Allow no-verify bypass',
    fleetOnly: true,
    label: 'HUSKY=0 (skips the whole .git-hooks/ chain)',
    matches: command => matchHuskySkip(command),
  },
  {
    // Pointing `core.hooksPath` away from `.git-hooks/` for one invocation
    // skips the whole chain exactly like HUSKY=0, so it carries the same
    // phrase. Detector, the three spellings it covers, the misses it does
    // not, and the foreign-repo carve-out that keeps the fleet's own
    // hostile-checkout hardening working: `hooks-path.mts`.
    bypassPhrase: 'Allow no-verify bypass',
    fleetOnly: true,
    label: 'git -c core.hooksPath (redirects the .git-hooks/ chain)',
    matches: (command, payload) => matchHooksPathSkip(command, payload),
  },
  {
    // SKIP_ASSET_DOWNLOAD is a documented degraded-mode flag in
    // socket-cli's download-assets.mts (use cached assets when
    // offline/rate-limited). It becomes a *bypass* when used to push
    // past pre-commit by short-circuiting the build's network step.
    // Treat as a bypass so agents can't unilaterally trade build
    // completeness for commit speed.
    bypassPhrase: 'Allow asset-download bypass',
    fleetOnly: true,
    label: 'SKIP_ASSET_DOWNLOAD=1 (skips release-asset fetch in build)',
    pattern: /\bSKIP_ASSET_DOWNLOAD\s*=\s*[1-9]/,
  },
  {
    // `git stash` (in any form: bare, push, save, --keep-index) is
    // forbidden in the primary checkout under the parallel-Claude
    // rule. The stash store is shared across sessions — another agent
    // can `git stash pop` yours and destroy work. CLAUDE.md says use
    // worktrees instead. This catches the *initial* stash (the
    // existing revert pattern below catches drop/pop/clear, which is
    // a separate destruction surface).
    //
    // Observed violation pattern: agents instinctively reach for
    // `git stash` when they want to test in a clean tree without
    // their changes interfering. Reflex of SWE muscle memory; the
    // worktree pattern is less familiar. Block the reflex; the
    // bypass phrase exists for single-session contexts where the
    // user knows no other agent session is active.
    bypassPhrase: 'Allow stash bypass',
    fleetOnly: true,
    label: 'git stash (primary-checkout parallel-Claude hazard)',
    // Any `git stash` (bare, or push/save/--keep-index/etc.) — but NOT
    // `git stash pop/drop/clear`, which the destructive-git check above
    // already owns, it's a different destruction surface.
    //
    // `list` and `show` are READ-ONLY: they print the stash entries or a
    // stash's diff and touch neither the stash store nor the working tree.
    // Blocking them stopped `git stash list` from answering "is anything
    // stashed here?", which is a question worth asking BEFORE reaching for
    // the bypass phrase. `apply` and `branch` stay blocked — they leave the
    // stash intact but still mutate the working tree.
    matches: command =>
      commandsFor(command, 'git').some(c =>
        gitSubcommandReadings(c.args).some(({ rest, sub }) => {
          if (sub !== 'stash') {
            return false
          }
          const action = rest.find(arg => !arg.startsWith('-'))
          // `clear` / `drop` / `pop` belong to the destructive-git check above,
          // a different destruction surface. `list` / `show` only print — the
          // read-only set is shared with parallel-agent-staging-guard, which had
          // the same blind spot, so the two cannot drift.
          return (
            action !== 'clear' &&
            action !== 'drop' &&
            action !== 'pop' &&
            !isReadOnlyStashAction(action)
          )
        }),
      )
        ? 'git stash'
        : undefined,
  },
  {
    // Bash file-write surfaces agents reach for when an Edit/Write hook
    // blocks them — the "go around" pattern: blocked on Edit by
    // markdown-filename-guard / path-guard / no-fleet-fork-guard / etc.,
    // then switch to `python3 -c` (or heredoc / printf >) to write the same
    // content via Bash, where Edit-layer hooks don't fire. Observed
    // 2026-05-12: agent used `python3 -c '...write(...)'` to rename a
    // markdown file after markdown-filename-guard blocked Edit on it.
    //
    // The contract: when an Edit/Write hook blocks, the path forward is (a)
    // move the file to a canonical location, (b) refactor so the rule no
    // longer triggers, or (c) get the bypass phrase for the original hook —
    // not switching tools to dodge it.
    //
    // Matches: python -c with open(...,'w')/.write_text(, a heredoc
    // redirected to a file, tee to a non-tmp file, dd of=<file>. In-place
    // stream editors (sed -i, perl/ruby -pi, etc.) are owned by
    // sed-in-place-guard, not duplicated here. NOT matched: plain `>`/`>>`
    // (too broad), mv/cp (moves, not writes), tools writing their own
    // output (tsc, pnpm build).
    bypassPhrase: 'Allow bash-write bypass',
    fleetOnly: true,
    label: 'Bash file-write (likely dodging an Edit/Write hook)',
    pattern:
      /(?:^|[\s;&|(`])(?:python3?\s+-c\b.*(?:open\([^)]*['"]w['"]?|\.write_text\(|\.write\([^)]*\)\s*$)|cat\s+<<-?\s*['"]?[A-Z_]+['"]?\b[^|;`]*>\s*[^/]|tee\s+(?!-)\S*\.(?:css|go|json|m?[jt]sx?|md|py|rs|sh|toml|ya?ml)\b|\bdd\s+[^|;`]*\bof=)/,
  },
]

// Match `--no-verify` anywhere in the command EXCEPT under `git rebase`.
// Returns the offending substring for the block message, or `undefined`
// when the flag is either absent or attached to an allowed subcommand.
//
// Allowed: `git rebase --no-verify ...` (replays existing commits; the
// commit-hook chain ran when they were first authored — re-running it
// during replay either no-ops or mutates content via autofix, both of
// which diverge the rebase from intent).
// Blocked: `git commit --no-verify`, `git push --no-verify`, env-var
// inline (`--no-verify` as a value), any other subcommand. The bypass
// phrase is still the way through for those.

// A `git commit` whose `-o`/`--only` pathspec is exactly a pnpm-lock.yaml (any
// dir) — the sanctioned lockfile-reconcile commit, see dirty-lockfile-nudge.
// `-o` restricts the commit to the named path, so nothing but the regenerated
// lockfile can land; that is what makes skipping the pre-commit chain safe.
// Conservative: requires `-o`/`--only` AND exactly one pathspec that is a
// pnpm-lock.yaml. Any extra pathspec, or a bare `git commit --no-verify` (which
// commits all staged files), is NOT exempt.
export function isLockfileOnlyReconcile(rest: readonly string[]): boolean {
  if (!rest.some(a => a === '--only' || a === '-o')) {
    return false
  }
  // Flags that consume the NEXT arg as their value, so it is not a pathspec.
  const VALUE_FLAGS = new Set([
    '--author',
    '--date',
    '--file',
    '--fixup',
    '--message',
    '--reedit-message',
    '--reuse-message',
    '--squash',
    '--template',
    '-C',
    '-c',
    '-F',
    '-m',
    '-t',
  ])
  const positionals: string[] = []
  for (let i = 0, { length } = rest; i < length; i += 1) {
    const a = rest[i]!
    if (a === '--') {
      for (let j = i + 1; j < length; j += 1) {
        positionals.push(rest[j]!)
      }
      break
    }
    if (a.startsWith('-')) {
      if (!a.includes('=') && VALUE_FLAGS.has(a)) {
        i += 1
      }
      continue
    }
    positionals.push(a)
  }
  return (
    positionals.length === 1 &&
    /(?:^|\/)pnpm-lock\.yaml$/.test(normalizePath(positionals[0]!))
  )
}

// Match `HUSKY=0` only where the shell would treat it as an environment
// assignment — COMMAND POSITION at the start of a segment (`HUSKY=0 git …`,
// `FOO=1 HUSKY=0 git …`, `env HUSKY=0 git …`, `export HUSKY=0`). A quoted
// argument mentioning the string (`grep "HUSKY=0" file`, an echo of the docs)
// is a read, not a skip, and must not trip the guard. Segments split on shell
// operators (&&, ||, ;, |, &, newline, subshell/group openers) so every
// command position in a chain is checked. Token walk, not a compound regex —
// the assignment-prefix run would need a nested-quantifier pattern the
// prompt-injection-guard rightly treats as a ReDoS shape. Known miss,
// accepted: an assignment smuggled inside a quoted eval string
// (`sh -c 'HUSKY=0 git …'`) — the same indirection limit the other pattern
// checks share.
const HUSKY_ZERO = /^HUSKY=(?:"0"|'0'|0)$/
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

export function matchHuskySkip(command: string): string | undefined {
  if (!command.includes('HUSKY=')) {
    return undefined
  }
  // `||` and `&&` — shell short-circuit operators; `;`, `|`, `&`, newline —
  // statement/pipe terminators; `$(` and backtick — command substitution openers;
  // `(` and `{` — subshell/compound-command starters.
  const segments = command.split(/\|\||&&|[;|&\n]|\$\(|`|[({]/)
  for (let j = 0, { length: jlen } = segments; j < jlen; j += 1) {
    const segment = segments[j]!
    const words = segment.trim().split(/\s+/)
    if (words[0] === 'export') {
      // `export HUSKY=0` persists for the whole shell session — block even
      // without a following command word.
      if (words.slice(1).some(w => HUSKY_ZERO.test(w))) {
        return 'export HUSKY=0'
      }
      continue
    }
    let i = 0
    if (words[i] === 'env') {
      i += 1
      // env flags (`-u NAME`, `-i`, `--chdir=…`) precede the assignments.
      while (i < words.length && words[i]!.startsWith('-')) {
        i += 1
      }
    }
    let sawHusky = false
    while (i < words.length && ENV_ASSIGNMENT.test(words[i]!)) {
      if (HUSKY_ZERO.test(words[i]!)) {
        sawHusky = true
      }
      i += 1
    }
    // Only an assignment run followed by a command word disables hooks; a
    // bare `HUSKY=0` segment sets a var for no command and skips nothing.
    if (sawHusky && i < words.length) {
      return 'HUSKY=0'
    }
  }
  return undefined
}

export function matchNoVerify(command: string): string | undefined {
  // Match the bare umbrella `--no-verify`, git hook-chain skip, but NOT granular
  // tool flags like `--no-verify-lint` / `--no-verify-format`. `\b` matched at
  // the hyphen (`y`|`-`), so it false-fired on every `--no-verify-<suffix>`; the
  // negative lookahead requires the flag to end (space / operator / EOS), so a
  // following `-` or word char, a suffixed tool flag, no longer matches.
  if (!/(?:^|\s)--no-verify(?![-\w])/.test(command)) {
    return undefined
  }
  // Walk every `git ...` invocation in the command (handles pipes,
  // `&&` chains, subshells via shell-quote tokenization). Track
  // whether we ever owned a `--no-verify` so we can tell apart
  // "all owners allowed", return undefined, from "no git owner
  // found at all", fall through to defensive block.
  let sawOwnedNoVerify = false
  for (const c of commandsFor(command, 'git')) {
    const { rest, sub } = splitGitSubcommand(c.args)
    const hasNoVerify = rest.some(a => a === '--no-verify')
    if (!hasNoVerify) {
      continue
    }
    sawOwnedNoVerify = true
    // Deliberately the CONFIDENT read, not the fail-closed one: this branch
    // decides which subcommand OWNS the flag so `git rebase --no-verify` and
    // the lockfile-only reconcile stay allowed. An ambiguous read falls
    // through to the block below, which is already the fail-closed answer.
    if (sub === 'rebase') {
      // Allowed shape — keep scanning. A chain like
      // `git rebase --no-verify && git commit --no-verify` still
      // has a forbidden second invocation we need to catch.
      continue
    }
    if (sub === 'commit' && isLockfileOnlyReconcile(rest)) {
      // Lockfile-only reconcile: `git commit -o pnpm-lock.yaml --no-verify`.
      // The `-o`/`--only` pathspec restricts the commit to the regenerated
      // lockfile and nothing else, so skipping the pre-commit chain on it is
      // safe. This is the sanctioned remedy from dirty-lockfile-nudge — a
      // dirty lockfile is never "someone else's"; `pnpm i` reconciles it, then
      // land it on its own — so it does not need the bypass phrase.
      continue
    }
    return `git ${sub} --no-verify`
  }
  if (sawOwnedNoVerify) {
    // Every `--no-verify` we saw was attached to an allowed
    // subcommand (rebase). Let the command through.
    return undefined
  }
  // The regex saw `--no-verify` but no `git` invocation owns it
  // (e.g. it appears inside a quoted commit-message body, or under
  // a different command entirely). Block defensively — false-positive
  // on quoted text is the safer side here, since the bypass phrase
  // is still a documented way through.
  return '--no-verify'
}

/**
 * True when a git segment is aimed at an `upstream/` reference tree, either via
 * `-C upstream/<name>` or an `upstream/…` pathspec.
 */
export function targetsUpstreamTree(args: readonly string[]): boolean {
  const i = args.indexOf('-C')
  if (i >= 0 && i + 1 < args.length && isUpstreamArg(args[i + 1])) {
    return true
  }
  return args.some(a => !a.startsWith('-') && isUpstreamArg(a))
}

function isUpstreamArg(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  const p = value.replaceAll('\\', '/')
  return (
    p === 'upstream' || p.startsWith('upstream/') || p.includes('/upstream/')
  )
}

export function matchDestructiveGit(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    // Restoring a vendored upstream to its pinned ref is a REPAIR, not a
    // revert. An `upstream/` tree is read-only and its whole value is being
    // byte-identical to the `ref =` in `.gitmodules`, so discarding local
    // edits there returns it to the only state it is allowed to hold. No
    // authored work can be lost: upstream-is-read-only-guard blocks writing
    // there in the first place, so anything found dirty got there by accident,
    // which is exactly what this repair undoes.
    if (targetsUpstreamTree(c.args)) {
      continue
    }
    for (const { rest, sub } of gitSubcommandReadings(c.args)) {
      const hit = destructiveGitShape(sub, rest)
      if (hit) {
        return hit
      }
    }
  }
  return undefined
}

export function blockMessage(
  command: string,
  match: RevertCheck,
  matchedSubstring: string,
  lossFacts?: ResetHardLossFacts | undefined,
): string {
  let steer = ''
  if (isResetHardToOrigin(command)) {
    const loss =
      lossFacts && (lossFacts.aheadCount > 0 || lossFacts.addedFiles.length)
        ? `drops ${lossFacts.aheadCount} commit${lossFacts.aheadCount === 1 ? '' : 's'} + ` +
          `${lossFacts.addedFiles.length} file${lossFacts.addedFiles.length === 1 ? '' : 's'} ` +
          `not on ${lossFacts.target} (a backup ref holds them); `
        : ''
    steer =
      ` — ${loss}LOCAL main is canonical in squash-cadence repos; ` +
      'Reconcile FORWARD (amend or lease-force-push local main), never rewind to origin'
  }
  return (
    `🚨 no-revert-guard: blocked "${matchedSubstring}" (${match.label}) in ` +
    `\`${command}\`${steer} ` +
    `(bypass response "${match.bypassPhrase}" verbatim — a paraphrase does not count)`
  )
}

// The target ref of a `git reset --hard <target>` (any ref: `origin/*`, a
// local branch, a SHA, `HEAD~N`), or `undefined` for a bare `git reset --hard`
// with no explicit target (implicit HEAD — discards working-tree/index
// changes only, never commits, so there's nothing a work-loss check needs to
// evaluate). Flag order is free (`reset --hard <ref>` and
// `reset <ref> --hard` both match); the target is the first positional arg
// that isn't `--hard` and doesn't look like a flag.
export function resetHardTarget(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    for (const { rest, sub } of gitSubcommandReadings(c.args)) {
      if (sub !== 'reset' || !rest.includes('--hard')) {
        continue
      }
      for (const a of rest) {
        if (a === '--hard' || a.startsWith('-')) {
          continue
        }
        return a
      }
    }
  }
  return undefined
}

// A `git reset --hard` whose target is an `origin/<branch>` ref — the exact
// shape that rewinds local main to the remote.
export function isResetHardToOrigin(command: string): boolean {
  return resetHardTarget(command)?.startsWith('origin/') ?? false
}

// The facts a `git reset --hard <target>` would discard, gathered straight
// from the repo. Undefined when any git query fails — the caller treats a
// gathering failure as "can't tell", which must never manufacture a block.
export interface ResetHardLossFacts {
  readonly target: string
  // `git rev-list --count <target>..HEAD` — commits on HEAD the reset drops.
  readonly aheadCount: number
  // The first ~10 of those commit SHAs (newest-first, rev-list's default
  // order), for the enumerated block message.
  readonly aheadShas: readonly string[]
  // `git diff --diff-filter=A --name-only <target>..HEAD` — files added on
  // HEAD that the target doesn't have, capped to the first ~10.
  readonly addedFiles: readonly string[]
  // True when some ref OTHER than the current branch's own ref and OTHER
  // than the reset target already contains HEAD — i.e. a backup exists that
  // would still hold this work after the reset lands.
  readonly hasBackup: boolean
}

const MAX_LISTED_LOSS_ITEMS = 10

export function gatherResetHardLossFacts(
  repoDir: string,
  target: string,
): ResetHardLossFacts | undefined {
  const countOut = gitOut(repoDir, ['rev-list', '--count', `${target}..HEAD`])
  if (countOut === undefined) {
    return undefined
  }
  const aheadCount = Number(countOut)
  if (!Number.isInteger(aheadCount)) {
    return undefined
  }
  const shaList = gitOut(repoDir, ['rev-list', `${target}..HEAD`])
  if (shaList === undefined) {
    return undefined
  }
  const aheadShas = shaList
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_LISTED_LOSS_ITEMS)
  const filesOut = gitOut(repoDir, [
    'diff',
    '--diff-filter=A',
    '--name-only',
    `${target}..HEAD`,
  ])
  if (filesOut === undefined) {
    return undefined
  }
  const addedFiles = filesOut
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_LISTED_LOSS_ITEMS)
  const refsOut = gitOut(repoDir, [
    'for-each-ref',
    '--format=%(refname)',
    '--contains',
    'HEAD',
  ])
  if (refsOut === undefined) {
    return undefined
  }
  const refs = refsOut.split('\n').filter(Boolean)
  const branch = currentBranch(repoDir)
  const currentRef = branch ? `refs/heads/${branch}` : undefined
  const targetRef = target.startsWith('refs/')
    ? target
    : target.startsWith('origin/')
      ? `refs/remotes/${target}`
      : `refs/heads/${target}`
  const hasBackup = refs.some(r => r !== currentRef && r !== targetRef)
  return { target, aheadCount, aheadShas, addedFiles, hasBackup }
}

// Pure: decide whether an unbacked `git reset --hard <target>` must be
// blocked UNCONDITIONALLY — independent of the revert bypass phrase. Takes
// precomputed facts, no git calls inside, so the decision is directly
// unit-testable with no live repo. Returns the block message, or undefined
// when there's nothing to lose, no commits ahead, no added files, or a
// backup ref already holds the work (falls through to the existing phrase
// gate, since the loss is recoverable).
export function decideResetHardLoss(
  facts: ResetHardLossFacts,
): string | undefined {
  const { addedFiles, aheadCount, aheadShas, hasBackup, target } = facts
  if (aheadCount <= 0 && addedFiles.length === 0) {
    return undefined
  }
  if (hasBackup) {
    return undefined
  }
  const dropped = [...aheadShas.map(sha => sha.slice(0, 8)), ...addedFiles]
  return (
    `🚨 no-revert-guard: blocked unbacked git reset --hard — drops ` +
    `${aheadCount} commit${aheadCount === 1 ? '' : 's'} + ` +
    `${addedFiles.length} file${addedFiles.length === 1 ? '' : 's'} not on ` +
    `${target} with NO backup ref; back up first ` +
    '(`git branch backup/<name> HEAD`), better reconcile FORWARD — ' +
    'unconditional, no bypass phrase applies.\n' +
    `   dropping: ${dropped.join(' ')}`
  )
}

export const check = bashGuard((command, payload): GuardResult => {
  // Unbacked work-loss gate: a `git reset --hard <target>` with no other
  // ref preserving HEAD's ahead commits or added files is blocked
  // UNCONDITIONALLY — even when the revert bypass phrase is present, since
  // the phrase can authorize a recoverable operation but can't manufacture
  // a backup that isn't there. Runs first and fails open on any git-query
  // error (repoDir unresolvable, git unavailable, non-integer count) so a
  // hook bug never blocks — it just falls through to the existing checks.
  // Every read runs in the repo the command TARGETS — a `git -C <dir>` reset
  // rewrites THAT repo's history, so its commits, files, and backup refs are
  // the ones the verdict and the message must name (`target-repo.mts`).
  const resetTarget = resetHardTarget(command)
  // Threaded to the later blockMessage() call so a RECOVERABLE reset-to-
  // origin, a backup exists, still names the exact commit/file count instead
  // of just the generic reconcile-forward steer.
  let resetLossFacts: ResetHardLossFacts | undefined
  if (resetTarget !== undefined) {
    const repoDir = resolveDestructiveGitRepoRoot({ command, payload })
    resetLossFacts =
      repoDir !== undefined
        ? gatherResetHardLossFacts(repoDir, resetTarget)
        : undefined
    if (resetLossFacts) {
      const lossMessage = decideResetHardLoss(resetLossFacts)
      if (lossMessage) {
        return block(lossMessage)
      }
    }
  }

  // Allowlist: fleet-sync cascade commands run in batches across every
  // repo and would otherwise need a fresh bypass phrase per repo. The
  // caller marks intent by setting `FLEET_SYNC=1` inline (the same way
  // CI=true is set inline). The sentinel is opt-in per command — no
  // global env-var poisoning — and only allows the two operations the
  // cascade actually needs:
  //
  //   1. `git commit --no-verify -m "chore(wheelhouse): cascade template@<sha>"`
  //      — the commit message MUST start with `chore(wheelhouse): cascade template@`.
  //   2. `git push --no-verify origin <ref>` — any branch / direct push.
  //
  // Anything else with `FLEET_SYNC=1` still falls through to the normal
  // checks below, so the sentinel can't be used as a blanket bypass for
  // unrelated destructive work.
  if (isFleetSyncCommand(command)) {
    const isCascadeCommit =
      /\bgit\s+commit\b/.test(command) &&
      /chore\(wheelhouse\):\s*cascade\s+template@/.test(command)
    const isCascadePush = /\bgit\s+push\b/.test(command)
    if (isCascadeCommit || isCascadePush) {
      return undefined
    }
  }

  // Allowlist: the `squashing-history` skill collapses the whole default
  // branch into one commit, then force-pushes it. The collapse commit trips
  // THIS guard's `--no-verify` check; the force-push trips the SEPARATE
  // no-force-push-guard, which shares this same sentinel. Both are
  // intrinsic to the squash — the resulting tree is byte-verified identical
  // to a backup branch before the push, so the hook chain has nothing new
  // to check. The caller marks intent with `SQUASH_HISTORY=1` inline (the
  // same opt-in-per-command shape as `FLEET_SYNC=1`).
  //
  // Hardened against malicious bypass (a poisoned prompt emitting
  // `SQUASH_HISTORY=1 git push --force …` to clobber a remote, or chaining
  // extra destructive work alongside it). `squashSentinelAllows` honors the
  // sentinel ONLY when the command parses to exactly ONE clean `git`
  // segment in the precise squash shape — any chaining, substitution,
  // eval/var indirection, extra invocation, or off-default-branch push
  // voids it and falls through to the normal blocking checks below.
  if (squashSentinelAllows(command)) {
    return undefined
  }

  // Find the first matching destructive pattern. A check is either a
  // regex (`pattern`, matched anywhere — flags / env vars) or a parser
  // detector (`matches`, command-structure — git subcommands).
  let triggered: { check: RevertCheck; matchedSubstring: string } | undefined
  for (let i = 0, { length } = CHECKS; i < length; i += 1) {
    const revertCheck = CHECKS[i]!
    if (revertCheck.matches) {
      const hit = revertCheck.matches(command, payload)
      if (hit) {
        triggered = { check: revertCheck, matchedSubstring: hit }
        break
      }
    } else if (revertCheck.pattern) {
      const m = command.match(revertCheck.pattern)
      if (m) {
        triggered = { check: revertCheck, matchedSubstring: m[0].trim() }
        break
      }
      /* c8 ignore start - every CHECKS entry has exactly one of matches/pattern; bare-else is defensive dead code */
    } else {
      continue
    }
    /* c8 ignore stop */
  }
  if (!triggered) {
    return undefined
  }

  // Repo-aware: a FLEET-CONVENTION check (--no-verify, gpg, stash, asset-
  // download, bash-write) protects the fleet's own process — the `.git-hooks/`
  // chain, fleet signing, the parallel-Claude rule, the fleet Edit hooks — none
  // of which exists in a non-fleet sibling, where `cd ../other-repo && git
  // commit --no-verify` would only misfire. `isFleetTarget` resolves the
  // command's effective repo (honoring any `cd`); it is computed lazily, only
  // after a fleetOnly check has triggered, so the common path pays no git cost.
  // The revert check carries no fleetOnly flag — destroying tracked work is
  // hazardous in ANY repo, so it stays universal.
  if (triggered.check.fleetOnly && !isFleetTarget(payload)) {
    return undefined
  }

  // Look for the canonical bypass phrase in user turns. The match is
  // case-sensitive and substring-based — a paraphrase doesn't count.
  if (
    operatorBypassPresent(payload.transcript_path, triggered.check.bypassPhrase)
  ) {
    return undefined
  }

  return block(
    blockMessage(
      command,
      triggered.check,
      triggered.matchedSubstring,
      resetLossFacts,
    ),
  )
})

export const hook = defineHook({
  bypass: [
    'revert',
    'no-verify',
    'gpg',
    'asset-download',
    'stash',
    'bash-write',
  ],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
