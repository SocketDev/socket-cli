#!/usr/bin/env node
// Claude Code PreToolUse hook — no-revert-guard.
//
// Blocks Bash commands that would revert tracked changes, bypass the
// git-hook chain (.git-hooks/ wired in via `core.hooksPath`), or
// otherwise destroy work in flight, unless the conversation has
// authorized the bypass via the canonical phrase
// `Allow <X> bypass` (case-sensitive, exact match).
//
// The bypass-phrase contract:
//   - Revert (git checkout/restore/reset/stash drop/stash pop/clean) →
//       user must type "Allow revert bypass" in a recent user turn.
//   - Hook bypass (--no-verify, --no-gpg-sign) →
//       user must type "Allow <X> bypass" where <X> matches the flag
//       (e.g. "Allow no-verify bypass", "Allow gpg bypass").
//
// Force-push (--force / -f / --force-with-lease / --force-if-includes) is
// its own guard: `.claude/hooks/fleet/no-force-push-guard/`.
//
// Phrase scoping: the hook reads the recent user turns from the
// transcript (most recent N user messages). A phrase from a prior
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
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { commandsFor, isFleetSyncCommand } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

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
  // Human-readable label for the rule (logged on rejection).
  readonly label: string
  // Detector. Exactly one of `pattern` / `matches` is set:
  //   - `pattern`: a regex matched anywhere in the command. Correct for
  //     flag rules (`--no-verify`, `--no-gpg-sign`) that apply
  //     regardless of which binary they sit on.
  //   - `matches`: a parser-based detector for command-STRUCTURE rules
  //     (which git subcommand runs). Returns the offending substring for
  //     the log, or undefined when no match. Sees through chains / `$(…)`
  //     / quotes, where a regex would over- or under-match.
  readonly pattern?: RegExp | undefined
  readonly matches?: (command: string) => string | undefined
}

// Pre-flight triggers: the dispatcher imports + runs this guard only when the
// raw command contains at least one of these substrings. Every blocking branch
// requires one verbatim:
//   - all git-structure checks (checkout/restore/reset/stash/clean/rm,
//     bare-stash) go through `commandsFor(command, 'git')`, which
//     short-circuits unless the line contains `git`.
//   - the --no-verify check is gated by a `--no-verify` regex.
//   - the gpg check matches `--no-gpg-sign` or `commit.gpgsign`.
//   - SKIP_ASSET_DOWNLOAD is its own literal.
//   - bash-write alternates over python / sed / cat (heredoc) / tee / dd.
// Keep COMPLETE: a missing trigger would silently skip the guard for a case it
// should block. Broad short tokens (`dd`, `tee`, `cat`, `sed`) are fine — over-
// triggering only re-runs the guard (status quo), it never disables it.
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
    label: 'git revert (checkout/restore/reset/stash/clean)',
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
    // (already-passed hooks) and the pre-commit chain would re-run hooks
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
    // user knows no other Claude session is active.
    bypassPhrase: 'Allow stash bypass',
    fleetOnly: true,
    label: 'git stash (primary-checkout parallel-Claude hazard)',
    // Any `git stash` (bare, or push/save/--keep-index/etc.) — but NOT
    // `git stash pop/drop/clear`, which the destructive-git check above
    // already owns (it's a different destruction surface).
    matches: command =>
      commandsFor(command, 'git').some(c => {
        if (c.args[0] !== 'stash') {
          return false
        }
        const sub = c.args[1]
        return sub !== 'clear' && sub !== 'drop' && sub !== 'pop'
      })
        ? 'git stash'
        : undefined,
  },
  {
    // Bash file-write surfaces agents reach for when an Edit/Write
    // hook blocks them. Catches the "go around" pattern: agent tries
    // Edit, gets blocked by markdown-filename-guard / path-guard /
    // no-fleet-fork-guard / etc., then switches to `python3 -c`
    // (or heredoc / printf >) to write the same content via Bash
    // where the Edit-layer hooks don't fire.
    //
    // The contract: when an Edit/Write hook blocks, the path forward
    // is (a) move the file to a canonical location, (b) refactor the
    // change so the rule no longer triggers, or (c) get the canonical
    // bypass phrase for the original hook. Switching tools to dodge
    // the hook is not a path.
    //
    // Observed 2026-05-12: agent used `python3 -c '...write(...)'`
    // to rename a markdown file after markdown-filename-guard blocked
    // Edit on it.
    //
    // Patterns matched:
    //   - python -c '...' with open(...,'w') or .write_text(
    //   - heredoc redirected to file (cat << EOF > file)
    //   - tee writing to a non-tmp file
    //   - dd of=<file>
    //
    // In-place STREAM editors (sed/gsed -i, --in-place, perl/ruby -pi,
    // gawk -i inplace) are owned by `sed-in-place-guard` — one detector,
    // richer flag coverage (incl. find -exec / xargs), and the
    // silent-drift rationale in its block message. Not duplicated here.
    //
    // Carve-outs intentionally NOT matched: plain `>` / `>>` (too
    // broad — every build/log/test invocation uses these), `mv` / `cp`
    // (file moves, not content writes), tools that write their own
    // output (`tsc`, `pnpm build`, etc. — they don't use Bash write
    // primitives directly).
    bypassPhrase: 'Allow bash-write bypass',
    fleetOnly: true,
    label: 'Bash file-write (likely dodging an Edit/Write hook)',
    pattern:
      /(?:^|[\s;&|(`])(?:python3?\s+-c\b.*(?:open\([^)]*['"]w['"]?|\.write_text\(|\.write\([^)]*\)\s*$)|cat\s+<<-?\s*['"]?[A-Z_]+['"]?\b[^|;`]*>\s*[^/]|tee\s+(?!-)\S*\.(?:m?[jt]sx?|json|md|ya?ml|toml|sh|py|rs|go|css)\b|\bdd\s+[^|;`]*\bof=)/,
  },
]

// Destructive `git` subcommands the revert rule blocks. Operates on a
// parsed git command's args (a1 = first arg = subcommand, rest = flags).
// Mirrors the old regex's surface:
//   checkout … -- <path> / checkout .   (discards working-tree changes)
//   restore <path>         (but NOT `restore --staged`, which only unstages)
//   reset --hard
//   stash clear|drop|pop
//   clean -f / --force / -xf / -df …
//   rm -f / -rf
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
// dir) — the sanctioned lockfile-reconcile commit (see dirty-lockfile-nudge).
// `-o` restricts the commit to the named path, so nothing but the regenerated
// lockfile can land; that is what makes skipping the pre-commit chain safe.
// Conservative: requires `-o`/`--only` AND exactly one pathspec that is a
// pnpm-lock.yaml. Any extra pathspec, or a bare `git commit --no-verify` (which
// commits all staged files), is NOT exempt.
export function isLockfileOnlyReconcile(rest: readonly string[]): boolean {
  if (!rest.some(a => a === '--only' || a === '-o')) {
    return false
  }
  // Flags that consume the NEXT arg as their value (so it is not a pathspec).
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
const HUSKY_ZERO = /^HUSKY=(?:0|'0'|"0")$/
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

export function matchHuskySkip(command: string): string | undefined {
  if (!command.includes('HUSKY=')) {
    return undefined
  }
  // `||` and `&&` — shell short-circuit operators; `;`, `|`, `&`, newline —
  // statement/pipe terminators; `$(` and backtick — command substitution openers;
  // `(` and `{` — subshell/compound-command starters.
  const segments = command.split(/\|\||&&|[;|&\n]|\$\(|`|[({]/)
  for (const segment of segments) {
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
  // Match the bare umbrella `--no-verify` (git hook-chain skip) but NOT granular
  // tool flags like `--no-verify-lint` / `--no-verify-format`. `\b` matched at
  // the hyphen (`y`|`-`), so it false-fired on every `--no-verify-<suffix>`; the
  // negative lookahead requires the flag to end (space / operator / EOS), so a
  // following `-` or word char (a suffixed tool flag) no longer matches.
  if (!/(?:^|\s)--no-verify(?![-\w])/.test(command)) {
    return undefined
  }
  // Walk every `git ...` invocation in the command (handles pipes,
  // `&&` chains, subshells via shell-quote tokenization). Track
  // whether we ever owned a `--no-verify` so we can tell apart
  // "all owners allowed" (return undefined) from "no git owner
  // found at all" (fall through to defensive block).
  let sawOwnedNoVerify = false
  for (const c of commandsFor(command, 'git')) {
    const [sub, ...rest] = c.args
    const hasNoVerify = rest.some(a => a === '--no-verify')
    if (!hasNoVerify) {
      continue
    }
    sawOwnedNoVerify = true
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

export function matchDestructiveGit(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    const [sub, ...rest] = c.args
    if (!sub) {
      continue
    }
    // Both discard the working tree: `git checkout -- <path>` (explicit
    // pathspec) and `git checkout .` (bare-dot pathspec). A pathspec-less
    // `git checkout <branch>` is a SWITCH, not a discard — left to
    // primary-checkout-branch-guard — so we key on `--` or a `.` arg.
    if (sub === 'checkout' && (rest.includes('--') || rest.includes('.'))) {
      return rest.includes('.') ? 'git checkout .' : 'git checkout -- <path>'
    }
    if (sub === 'restore' && !rest.includes('--staged')) {
      return 'git restore'
    }
    if (sub === 'reset' && rest.includes('--hard')) {
      return 'git reset --hard'
    }
    if (
      sub === 'stash' &&
      (rest[0] === 'clear' || rest[0] === 'drop' || rest[0] === 'pop')
    ) {
      return `git stash ${rest[0]}`
    }
    // Force flag in any form: short `-f`/`-xf`/`-df` (the `/^-[a-z]*f/`
    // bundle) OR long `--force`. The long form slips the short-flag regex
    // (`--force` has no `f` in the `-[a-z]*` run), so test it explicitly —
    // `git clean --force -d` wipes untracked files just like `git clean -fd`.
    // Dry-run (`-n`/`--dry-run`) carries no force flag, so it stays allowed.
    if (
      sub === 'clean' &&
      rest.some(a => /^-[a-z]*f/.test(a) || a.startsWith('--force'))
    ) {
      return 'git clean -f'
    }
    if (sub === 'rm' && rest.some(a => /^-r?f?$/.test(a) && a.includes('f'))) {
      return 'git rm -f'
    }
  }
  return undefined
}

export function blockMessage(
  command: string,
  match: RevertCheck,
  matchedSubstring: string,
): string {
  const lines: string[] = []
  lines.push('[no-revert-guard] Blocked: destructive / hook-bypass command.')
  lines.push(`  Rule:    ${match.label}`)
  lines.push(`  Match:   ${matchedSubstring}`)
  lines.push(`  Command: ${command}`)
  lines.push('')
  lines.push('  This operation either reverts tracked changes or bypasses the')
  lines.push('  fleet hook chain. Both destroy work or skip safety checks.')
  lines.push('')
  lines.push(
    `  To proceed, the user must type the EXACT phrase in a new message:`,
  )
  lines.push(`    ${match.bypassPhrase}`)
  lines.push('')
  lines.push(
    '  The phrase is case-sensitive. Inferring intent from a paraphrase',
  )
  lines.push('  ("go ahead", "skip the hook", "fine") does NOT count.')
  if (isResetHardToOrigin(command)) {
    lines.push('')
    lines.push('  Resetting local main to origin/<default>? In squash-cadence')
    lines.push('  fleet repos LOCAL main is canonical — origin ahead usually')
    lines.push('  means your own squashed/bot commits, not newer work.')
    lines.push('  Reconcile FORWARD: compare timestamps, then amend (1-commit')
    lines.push('  squash) or lease-force-push local main. Never rewind local')
    lines.push(
      '  to origin. Detail: docs/agents.md/fleet/parallel-claude-sessions.md',
    )
  }
  return lines.join('\n')
}

// A `git reset --hard` whose target is an `origin/<branch>` ref — the exact
// shape that rewinds local main to the remote. Flag order is free
// (`reset --hard origin/main` and `reset origin/main --hard` both match), so
// test the two tokens independently within the command.
export function isResetHardToOrigin(command: string): boolean {
  for (const c of commandsFor(command, 'git')) {
    const [sub, ...rest] = c.args
    if (
      sub === 'reset' &&
      rest.includes('--hard') &&
      rest.some(a => a.startsWith('origin/'))
    ) {
      return true
    }
  }
  return false
}

export const check = bashGuard((command, payload): GuardResult => {
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
      const hit = revertCheck.matches(command)
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
    bypassPhrasePresent(payload.transcript_path, triggered.check.bypassPhrase)
  ) {
    return undefined
  }

  return block(
    blockMessage(command, triggered.check, triggered.matchedSubstring),
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
