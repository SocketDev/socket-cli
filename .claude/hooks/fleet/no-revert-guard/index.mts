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
//   - Force push --force-with-lease (safer; aborts if remote moved) →
//       user must type "Allow force-with-lease bypass" OR the stronger
//       "Allow force-push bypass" (which subsumes the safer lease op).
//   - Force push --force / -f, no lease (CAN silently clobber remote
//       commits) → user must type "Allow force-push-hard bypass". Always
//       reach for --force-with-lease first; this is the high-friction path.
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

import process from 'node:process'

import { commandsFor, parseCommands } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?: { command?: string | undefined } | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

type GuardCheck = {
  // Canonical phrase the user must type to bypass.
  readonly bypassPhrase: string
  // Optional extra phrases that ALSO authorize this rule — used when a
  // stronger-scope phrase should subsume a safer operation (e.g. the
  // bare-force phrase authorizing the safer --force-with-lease too).
  readonly alsoAcceptedPhrases?: readonly string[] | undefined
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

const CHECKS: readonly GuardCheck[] = [
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
    label: 'git --no-gpg-sign / commit.gpgsign=false',
    pattern: /(?:--no-gpg-sign|commit\.gpgsign\s*=\s*false)\b/,
  },
  {
    // SKIP_ASSET_DOWNLOAD is a documented degraded-mode flag in
    // socket-cli's download-assets.mts (use cached assets when
    // offline/rate-limited). It becomes a *bypass* when used to push
    // past pre-commit by short-circuiting the build's network step.
    // Treat as a bypass so agents can't unilaterally trade build
    // completeness for commit speed.
    bypassPhrase: 'Allow asset-download bypass',
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
    // (or `sed -i` / heredoc / printf >) to write the same content
    // via Bash where the Edit-layer hooks don't fire.
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
    //   - sed -i (in-place edit)
    //   - heredoc redirected to file (cat << EOF > file)
    //   - tee writing to a non-tmp file
    //   - dd of=<file>
    //
    // Carve-outs intentionally NOT matched: plain `>` / `>>` (too
    // broad — every build/log/test invocation uses these), `mv` / `cp`
    // (file moves, not content writes), tools that write their own
    // output (`tsc`, `pnpm build`, etc. — they don't use Bash write
    // primitives directly).
    bypassPhrase: 'Allow bash-write bypass',
    label: 'Bash file-write (likely dodging an Edit/Write hook)',
    pattern:
      /(?:^|[\s;&|(`])(?:python3?\s+-c\b.*(?:open\([^)]*['"]w['"]?|\.write_text\(|\.write\([^)]*\)\s*$)|sed\s+-i\b|cat\s+<<-?\s*['"]?[A-Z_]+['"]?\b[^|;`]*>\s*[^/]|tee\s+(?!-)\S*\.(?:m?[jt]sx?|json|md|ya?ml|toml|sh|py|rs|go|css)\b|\bdd\s+[^|;`]*\bof=)/,
  },
  {
    // --force-with-lease refuses the push if the remote moved since the
    // last fetch — safer than --force because it can't silently clobber
    // someone else's commits. Always prefer this form. Its own phrase is
    // the low-friction path; the stronger `Allow force-push bypass` also
    // authorizes it, since lease is strictly safer than the bare force
    // that phrase covers — so a user who typed the broader phrase isn't
    // forced to retype a narrower one for the safer op.
    bypassPhrase: 'Allow force-with-lease bypass',
    alsoAcceptedPhrases: ['Allow force-push bypass'],
    label: 'git push --force-with-lease',
    matches: command =>
      commandsFor(command, 'git').some(
        c =>
          c.args.includes('push') &&
          c.args.some(a => a.startsWith('--force-with-lease')),
      )
        ? 'git push --force-with-lease'
        : undefined,
  },
  {
    // Raw --force / -f bypasses the lease check and CAN silently
    // overwrite remote commits. This is the highest-friction push path:
    // its phrase (`Allow force-push-hard bypass`) is distinct from and
    // NOT subsumed by the lease phrases. Reach for --force-with-lease
    // first; bare --force is for the narrow cases where the remote really
    // should be overwritten unconditionally (recovering from corruption,
    // force-clobbering a doomed experimental branch the user owns).
    bypassPhrase: 'Allow force-push-hard bypass',
    label: 'git push --force / -f (no lease)',
    matches: command =>
      commandsFor(command, 'git').some(
        c =>
          c.args.includes('push') &&
          (c.args.includes('--force') || c.args.includes('-f')) &&
          // Allow --force-with-lease through this rule (it's handled
          // by the preceding lease-specific rule).
          !c.args.some(a => a.startsWith('--force-with-lease')),
      )
        ? 'git push --force'
        : undefined,
  },
]

// Destructive `git` subcommands the revert rule blocks. Operates on a
// parsed git command's args (a1 = first arg = subcommand, rest = flags).
// Mirrors the old regex's surface:
//   checkout … -- <path>   (discards working-tree changes)
//   restore <path>         (but NOT `restore --staged`, which only unstages)
//   reset --hard
//   stash clear|drop|pop
//   clean -f / -xf / -df …
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
export function matchNoVerify(command: string): string | undefined {
  if (!/(?:^|\s)--no-verify\b/.test(command)) {
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
    if (sub === 'checkout' && rest.includes('--')) {
      return 'git checkout -- <path>'
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
    if (sub === 'clean' && rest.some(a => /^-[a-z]*f/.test(a))) {
      return 'git clean -f'
    }
    if (sub === 'rm' && rest.some(a => /^-r?f?$/.test(a) && a.includes('f'))) {
      return 'git rm -f'
    }
  }
  return undefined
}

// The exact, full message the squash collapse commit must carry. Anchored
// so a longer message (`chore: initial commit && rm -rf …` smuggled into the
// `-m` value) cannot satisfy it.
const SQUASH_COMMIT_MESSAGE = 'chore: initial commit'

// Push forms that are NEVER part of a squash and could weaponize the
// sentinel into clobbering many refs at once or deleting a branch.
const FORBIDDEN_PUSH_FLAGS = new Set([
  '--all',
  '--mirror',
  '--tags',
  '--delete',
  '-d',
  '--prune',
  '--no-verify',
])

// Reads the `-m` / `--message` value out of a parsed git arg list. Supports
// both `-m value` (two tokens) and `--message=value` (one token). Returns
// undefined when no message flag is present.
export function readCommitMessageArg(
  args: readonly string[],
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === '-m' || a === '--message') {
      return args[i + 1]
    }
    if (a.startsWith('--message=')) {
      return a.slice('--message='.length)
    }
    if (a.startsWith('-m=')) {
      return a.slice('-m='.length)
    }
  }
  return undefined
}

/**
 * Decide whether an inline `SQUASH_HISTORY=1` sentinel authorizes this exact
 * command. Hardened against malicious bypass: a poisoned prompt must not be
 * able to ride the sentinel to clobber an arbitrary remote, delete refs, or
 * chain extra destructive work.
 *
 * The sentinel is honored ONLY when ALL of these hold. The line must parse to
 * EXACTLY ONE command segment (no `&&` / `;` / `|` chaining and no `$(…)`
 * substitution, which both parse to extra segments); that segment must be a
 * statically-resolved `git` binary (not `$VAR`/eval); the `SQUASH_HISTORY=1`
 * sentinel must be its ONLY inline env assignment (no smuggled
 * `GIT_SSH_COMMAND=…`); and the git subcommand must be one of the two squash
 * shapes — a `commit --amend` whose `-m` message is EXACTLY `chore: initial
 * commit`, or a `push` carrying `--force` / `--force-with-lease` / `-f` to a
 * bare remote with at most one plain positional branch ref (no `src:dst`
 * refspec, no `HEAD:`) and none of the multi-ref / delete / verify-skipping
 * flags in FORBIDDEN_PUSH_FLAGS.
 *
 * Any deviation returns false → the command falls through to the normal
 * blocking checks, where it still needs a typed bypass phrase.
 */
export function squashSentinelAllows(command: string): boolean {
  // (1) Sentinel must be present as a structural assignment, confirmed below
  // via the parsed segment's `assignments`. The cheap regex is just a gate.
  if (!/(?:^|\s)SQUASH_HISTORY\s*=\s*1\b/.test(command)) {
    return false
  }
  // (2) The line must parse to EXACTLY ONE command segment. A chain
  // (`&& rm -rf …`), a pipe, or a `$(…)` substitution all yield extra
  // segments — any of those voids the sentinel.
  const segments = parseCommands(command)
  if (segments.length !== 1) {
    return false
  }
  const c = segments[0]!
  // (3) Statically-resolved `git`, never variable/eval-sourced.
  if (c.binary !== 'git' || c.viaVariable || c.viaEval) {
    return false
  }
  // (4) The sentinel must be the sole inline assignment.
  if (
    c.assignments.length !== 1 ||
    !/^SQUASH_HISTORY\s*=\s*1$/.test(c.assignments[0]!)
  ) {
    return false
  }
  const [sub, ...rest] = c.args
  // (5a) Squash collapse commit.
  if (sub === 'commit') {
    if (!rest.includes('--amend')) {
      return false
    }
    const msg = readCommitMessageArg(rest)
    return msg === SQUASH_COMMIT_MESSAGE
  }
  // (5b) Squash force-push.
  if (sub === 'push') {
    const hasForce = rest.some(
      a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease'),
    )
    if (!hasForce) {
      return false
    }
    if (rest.some(a => FORBIDDEN_PUSH_FLAGS.has(a))) {
      return false
    }
    // Positional (non-flag) args = remote + optional ref. Allow a bare
    // remote with at most one plain branch ref; reject refspecs (`a:b`),
    // `HEAD:`, and globs.
    const positionals = rest.filter(a => !a.startsWith('-'))
    if (positionals.length < 1 || positionals.length > 2) {
      return false
    }
    if (positionals.some(a => a.includes(':') || a.includes('*'))) {
      return false
    }
    return true
  }
  return false
}

export function emitBlock(
  command: string,
  match: GuardCheck,
  matchedSubstring: string,
): void {
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
  process.stderr.write(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Bash') {
    return
  }
  const command = payload.tool_input?.command ?? ''
  if (!command) {
    return
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
  if (/(?:^|\s)FLEET_SYNC\s*=\s*1\b/.test(command)) {
    const isCascadeCommit =
      /\bgit\s+commit\b/.test(command) &&
      /chore\(wheelhouse\):\s*cascade\s+template@/.test(command)
    const isCascadePush = /\bgit\s+push\b/.test(command)
    if (isCascadeCommit || isCascadePush) {
      return
    }
  }

  // Allowlist: the `squashing-history` skill collapses the whole default
  // branch into one commit, then force-pushes it. Both steps trip a guard
  // (`--no-verify` on the collapse commit; `--force*` on the push), yet
  // both are intrinsic to the squash — the resulting tree is byte-verified
  // identical to a backup branch before the push, so the hook chain has
  // nothing new to check. The caller marks intent with `SQUASH_HISTORY=1`
  // inline (the same opt-in-per-command shape as `FLEET_SYNC=1`).
  //
  // Hardened against malicious bypass (a poisoned prompt emitting
  // `SQUASH_HISTORY=1 git push --force …` to clobber a remote, or chaining
  // extra destructive work alongside it). `matchSquashSentinelAllowed`
  // honors the sentinel ONLY when the command parses to exactly ONE clean
  // `git` segment in the precise squash shape — any chaining, substitution,
  // eval/var indirection, extra invocation, or off-default-branch push
  // voids it and falls through to the normal blocking checks below.
  if (squashSentinelAllows(command)) {
    return
  }

  // Find the first matching destructive pattern. A check is either a
  // regex (`pattern`, matched anywhere — flags / env vars) or a parser
  // detector (`matches`, command-structure — git subcommands).
  let triggered: { check: GuardCheck; matchedSubstring: string } | undefined
  for (let i = 0, { length } = CHECKS; i < length; i += 1) {
    const check = CHECKS[i]!
    if (check.matches) {
      const hit = check.matches(command)
      if (hit) {
        triggered = { check, matchedSubstring: hit }
        break
      }
    } else if (check.pattern) {
      const m = command.match(check.pattern)
      if (m) {
        triggered = { check, matchedSubstring: m[0].trim() }
        break
      }
    }
  }
  if (!triggered) {
    return
  }

  // Look for the canonical bypass phrase (or any phrase that subsumes it)
  // in user turns. The match is case-sensitive and substring-based — a
  // paraphrase doesn't count.
  const acceptedPhrases = [
    triggered.check.bypassPhrase,
    ...(triggered.check.alsoAcceptedPhrases ?? []),
  ]
  if (
    acceptedPhrases.some(phrase =>
      bypassPhrasePresent(payload.transcript_path, phrase),
    )
  ) {
    return
  }

  emitBlock(command, triggered.check, triggered.matchedSubstring)
  process.exitCode = 2
}

main().catch(e => {
  // Fail open on hook bugs.
  process.stderr.write(
    `[no-revert-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
