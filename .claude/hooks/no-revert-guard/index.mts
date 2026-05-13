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
//   - Force push (--force / -f to push or push-with-lease) →
//       user must type "Allow force-push bypass".
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

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?: { command?: string } | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

type GuardCheck = {
  // Canonical phrase the user must type to bypass.
  readonly bypassPhrase: string
  // Human-readable label for the rule (logged on rejection).
  readonly label: string
  // Pattern that detects the destructive command.
  readonly pattern: RegExp
}

const CHECKS: readonly GuardCheck[] = [
  {
    bypassPhrase: 'Allow revert bypass',
    label: 'git revert (checkout/restore/reset/stash/clean)',
    // Match destructive git commands. Anchored on `git ` or `git\t`
    // (with optional leading whitespace) so we don't match inside
    // arbitrary strings.
    pattern:
      /(?:^|[\s;&|(`])git\s+(?:checkout\s+(?:--?[a-z]+\s+)*(?:--\s|\S+\s+--\s)|restore(?!\s+--staged\b)|reset\s+--hard|stash\s+(?:drop|pop|clear)|clean\s+-[a-z]*f|rm\s+-r?f?\s)/,
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
    pattern:
      /(?:^|[\s;&|(`])git\s+stash(?:\s+(?:push|save|--keep-index|--patch|-[a-z]+)|\s*$|\s+[^a-z])/,
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
    bypassPhrase: 'Allow force-push bypass',
    label: 'git push --force / -f',
    pattern: /(?:^|[\s;&|(`])git\s+push\b[^;&|()`]*\s(?:--force\b|-f\b)/,
  },
]

function emitBlock(
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

  // Find the first matching destructive pattern.
  let triggered: { check: GuardCheck; matchedSubstring: string } | undefined
  for (const check of CHECKS) {
    const m = command.match(check.pattern)
    if (m) {
      triggered = { check, matchedSubstring: m[0].trim() }
      break
    }
  }
  if (!triggered) {
    return
  }

  // Look for the canonical bypass phrase in user turns. The match is
  // case-sensitive and substring-based — a paraphrase doesn't count.
  if (bypassPhrasePresent(payload.transcript_path, triggered.check.bypassPhrase)) {
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
