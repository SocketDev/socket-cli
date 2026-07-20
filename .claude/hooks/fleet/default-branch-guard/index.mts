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
// It ALSO emits a non-blocking reminder (notify, not block) when a
// command renames a branch ONTO the default name to switch the default
// branch — `git branch -m <src> main` / `-M` / `--move`, or the GitHub
// `.../branches/<src>/rename` API with `new_name=main`. That rename
// FAILS if a branch by that name already exists, so the reminder is to
// free the target name first (delete/relocate the existing `main`) and
// only then rename the source. Learned the hard way switching a repo's
// default from `probe` → `main` while a `main` branch already existed.
//
// Bypass: "Allow default-branch bypass" in a recent user turn, or set

import {
  bashGuard,
  block,
  defineHook,
  notify,
  runHook,
} from '../_shared/guard.mts'

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

// A branch RENAME whose NEW name (the last branch argument) is the default
// branch: `git branch -m <src> main` / `-M main` / `--move <src> master`.
// `main`/`master` must be the FINAL token of the segment so a rename AWAY from
// the default (`git branch -m main develop`) does not match.
const RENAME_TO_DEFAULT_RE =
  /\bgit\s+branch\s+(?:-[mM]|--move)\b[^\n;|&]*?\b(?:main|master)\b\s*(?:$|[\n;&|])/
// GitHub's branch-rename API — `POST .../branches/<src>/rename` with
// `new_name=main` — switches the default the same way and hits the same wall.
const GH_RENAME_ENDPOINT_RE = /\/branches\/[^/\s]+\/rename\b/
const GH_RENAME_NEW_NAME_DEFAULT_RE = /\bnew_name[=\s"']+(?:main|master)\b/

export const check = bashGuard((command, payload) => {
  // Renaming a branch ONTO the default name to switch the default branch: a
  // non-blocking reminder that the target name must be free first. Returns
  // before the hard-coded-branch block logic — the rename itself is allowed.
  if (
    RENAME_TO_DEFAULT_RE.test(command) ||
    (GH_RENAME_ENDPOINT_RE.test(command) &&
      GH_RENAME_NEW_NAME_DEFAULT_RE.test(command))
  ) {
    return notify(
      [
        "[default-branch-guard] Switching the default branch by renaming won't work while the target name already exists.",
        '',
        '  Renaming a branch to `main`/`master` (git branch -m / -M / --move, or the',
        '  GitHub `.../branches/<src>/rename` API) FAILS if a branch by that name is',
        '  already present. To switch the default from e.g. `probe` → `main`:',
        '',
        '    1. Make sure the branch you are KEEPING has the content you want.',
        '    2. Delete or relocate the existing `main` first (git branch -D main, or',
        '       delete the remote ref) so the name is free.',
        '    3. THEN rename the source: git branch -m <src> main — it inherits default.',
        '',
        '  Non-blocking reminder — the rename proceeds.',
      ].join('\n') + '\n',
    )
  }

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
    return undefined
  }

  void payload

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
  return block(lines.join('\n') + '\n')
})

export const hook = defineHook({
  bypass: ['default-branch'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
