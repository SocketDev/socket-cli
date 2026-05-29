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
//   - Hook bypass (--no-verify, DISABLE_PRECOMMIT_*, --no-gpg-sign) →
//       user must type "Allow <X> bypass" where <X> matches the flag
//       (e.g. "Allow no-verify bypass", "Allow lint bypass",
//        "Allow gpg bypass").
//   - Force push --force-with-lease (safer; aborts if remote moved) →
//       user must type "Allow force-with-lease bypass".
//   - Force push --force / -f (CAN silently clobber remote commits) →
//       user must type "Allow force-push bypass". Always reach for
//       --force-with-lease first; this is the high-friction path.
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

import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?: { command?: string | undefined } | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

type GuardCheck = {
  // Canonical phrase the user must type to bypass.
  readonly bypassPhrase: string
  // Human-readable label for the rule (logged on rejection).
  readonly label: string
  // Detector. Exactly one of `pattern` / `matches` is set:
  //   - `pattern`: a regex matched anywhere in the command. Correct for
  //     flag / env-var rules (`--no-verify`, `DISABLE_PRECOMMIT_LINT=1`)
  //     that apply regardless of which binary they sit on.
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
    pattern: /(?:^|\s)--no-verify\b/,
  },
  {
    bypassPhrase: 'Allow gpg bypass',
    label: 'git --no-gpg-sign / commit.gpgsign=false',
    pattern: /(?:--no-gpg-sign|commit\.gpgsign\s*=\s*false)\b/,
  },
  {
    bypassPhrase: 'Allow lint bypass',
    label: 'DISABLE_PRECOMMIT_LINT=1 (skips lint step in pre-commit hook)',
    pattern: /\bDISABLE_PRECOMMIT_LINT\s*=\s*[1-9]/,
  },
  {
    bypassPhrase: 'Allow test bypass',
    label: 'DISABLE_PRECOMMIT_TEST=1 (skips test step in pre-commit hook)',
    pattern: /\bDISABLE_PRECOMMIT_TEST\s*=\s*[1-9]/,
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
    // someone else's commits. Always prefer this form. Lower-friction
    // bypass phrase so users aren't tempted to reach for raw --force
    // when --force-with-lease would do.
    bypassPhrase: 'Allow force-with-lease bypass',
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
    // overwrite remote commits. Always reach for --force-with-lease
    // first; this rule + bypass phrase exist for the narrow cases
    // where the remote really should be overwritten unconditionally
    // (recovering from corruption, force-clobbering a doomed
    // experimental branch the user owns).
    bypassPhrase: 'Allow force-push bypass',
    label: 'git push --force / -f',
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

  // Look for the canonical bypass phrase in user turns. The match is
  // case-sensitive and substring-based — a paraphrase doesn't count.
  if (
    bypassPhrasePresent(payload.transcript_path, triggered.check.bypassPhrase)
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
