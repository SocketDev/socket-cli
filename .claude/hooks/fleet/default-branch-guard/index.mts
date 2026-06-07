#!/usr/bin/env node
// Claude Code PreToolUse hook — default-branch-guard.
//
// Blocks Bash invocations that hard-code `main` or `master` as the
// default branch in places where the fleet's "Default branch fallback"
// rule says to use a `git symbolic-ref refs/remotes/origin/HEAD`
// lookup with main→master fallback.
//
// What it catches (Bash commands that look like a script body, not a
// one-off):
//
//   - Hard-coded `git diff main...HEAD` / `git rev-list main..HEAD`
//     when the user is constructing a script (BASE=, default branch
//     resolution, scripting context).
//
//   - `BASE=main` / `BASE=master` literal assignments.
//
//   - `--base main` / `--base=main` literal flag values (for `gh pr`,
//     etc.) in scripting context.
//
// The heuristic is generous: a plain `git checkout main` or `git pull
// origin main` is allowed (those are interactive one-offs). The hook
// fires when the command shape implies a reusable script.
//
// Bypass: "Allow default-branch bypass" in a recent user turn, or set

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASES = [
  'Allow default-branch bypass',
  'Allow default branch bypass',
  'Allow defaultbranch bypass',
] as const

// Patterns we consider "script context" (not interactive one-off):
//
//   BASE=main       — variable assignment defaulting to main
//   --base=main     — flag value
//   --base main     — flag value (space-separated)
//
// Each pattern's regex must include enough context to distinguish
// scripting from interactive use.
const SCRIPT_CONTEXT_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> =
  [
    {
      label: 'BASE=main / BASE=master literal assignment',
      regex: /\bBASE\s*=\s*(["']?)(?:main|master)\1\b/,
    },
    {
      label: '--base main / --base=main literal value',
      regex: /--base[\s=](["']?)(?:main|master)\1\b/,
    },
    {
      label: 'DEFAULT_BRANCH=main literal assignment',
      regex:
        /\b(?:DEFAULT_BRANCH|MAIN_BRANCH)\s*=\s*(["']?)(?:main|master)\1\b/,
    },
  ]

// Heredoc / file-write detection: when the command writes a script
// (e.g. via cat > file.sh, tee, redirect), be stricter — any reference
// to `main..HEAD` / `main...HEAD` inside the writeable body counts as
// scripting context.
const SCRIPT_WRITE_RE =
  /(?:cat\s*>\s*|tee\s+|>\s*)\S+\.(?:bash|fish|js|mjs|mts|sh|ts|zsh)\b/

const TRIPLE_DOT_BRANCH_RE = /\b(?:main|master)\.{2,3}HEAD\b/

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw.
await withBashGuard((command, payload) => {

  const hits: string[] = []
  for (let i = 0, { length } = SCRIPT_CONTEXT_PATTERNS; i < length; i += 1) {
    const pattern = SCRIPT_CONTEXT_PATTERNS[i]!
    if (pattern.regex.test(command)) {
      hits.push(pattern.label)
    }
  }
  if (SCRIPT_WRITE_RE.test(command) && TRIPLE_DOT_BRANCH_RE.test(command)) {
    hits.push(
      'writing a script file with `main..HEAD` / `master..HEAD` literal — ' +
        'resolve BASE via `git symbolic-ref` instead',
    )
  }
  if (hits.length === 0) {
    return
  }

  // Transcript read is the expensive last gate — only reached once a
  // hard-coded default-branch pattern matched and we would otherwise block.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    return
  }

  const lines = [
    '[default-branch-guard] Command hard-codes a default branch name in scripting context:',
    '',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    lines.push(`  • ${hits[i]}`)
  }
  lines.push('')
  lines.push(
    '  Per CLAUDE.md "Default branch fallback", scripts must look up the',
  )
  lines.push("  remote's HEAD and fall back main → master, not hard-code one:")
  lines.push('')
  lines.push(
    "    BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')",
  )
  lines.push(
    '    [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main && BASE=main',
  )
  lines.push(
    '    [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master && BASE=master',
  )
  lines.push('    BASE="${BASE:-main}"')
  lines.push('')
  lines.push(
    '  Bypass: type "Allow default-branch bypass" in a recent message.',
  )
  lines.push('')
  logger.error(lines.join('\n') + '\n')
  process.exitCode = 2
})
