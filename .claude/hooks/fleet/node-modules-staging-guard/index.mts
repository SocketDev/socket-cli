#!/usr/bin/env node
// Claude Code PreToolUse hook — node-modules-staging-guard.
//
// Blocks `git add -f` / `git add --force` invocations targeting paths
// that contain `/node_modules/` or that point at a `package-lock.json`
// under `.claude/hooks/*/` or `.claude/skills/*/`. Past incident: a
// cascading agent used `git add -f` to commit `.claude/hooks/check-new-
// deps/node_modules/` into 6 fleet repos. Removing it required force-
// push, which is itself a hazard, or filter-branch/filter-repo.
//
// The `-f` (force) flag exists for the rare case where a gitignored
// file legitimately needs to be staged. It should never be used for
// node_modules or hook/skill package-lock.json files — those are
// gitignored intentionally because each consumer runs its own install.
//
// Detection: parse the Bash command, look for `git add -f` (or
// `--force`), then check every path argument. If any path contains
// `node_modules/`, anywhere in the path, OR points at a
// `package-lock.json` under `.claude/hooks/<name>/` /
// `.claude/skills/<name>/`, block.
//
// Bypass: `Allow node-modules-staging bypass` typed verbatim in a recent
// user turn. Use sparingly — legitimate force-stages of node_modules
// are vanishingly rare.

import { lstatSync } from 'node:fs'
import path from 'node:path'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

// Dispatcher pre-flight: a block requires a forbidden PATH arg, and every
// forbidden path (per `isForbiddenPath`) contains one of these substrings —
// a `node_modules` segment, or a hook/skill `package-lock.json` /
// `pnpm-lock.yaml`. A command lacking all three can never block, so the
// dispatcher skips importing this guard for it.
// `git add` earns its place here even though it names no forbidden path: the
// BROAD form (`-A` / `--all` / `.` / `:/`) stages whatever is in the tree,
// including an untracked `node_modules` SYMLINK, and the command string
// carries no substring the other triggers would match. That is the shape that
// actually got a symlink committed three times in one session while this guard
// sat unloaded.
export const triggers: readonly string[] = [
  'git add',
  'node_modules',
  'package-lock.json',
  'pnpm-lock.yaml',
]

// A worktree gets `node_modules` as a SYMLINK to the primary checkout so the
// fleet tooling resolves. Git sees a symlink as a FILE, so `node_modules/`
// with a trailing slash in .gitignore misses it entirely and a broad add
// stages the link. In CI the target is absent, so the dangling link throws
// ENOENT and the install dies before anything runs.
export function nodeModulesIsSymlink(dir: string): boolean {
  try {
    return lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
  } catch {
    return false
  }
}

// A `cd` that a later `git add` would inherit. Breakdown for a junior reader:
//   (?:^|&&|;|\n)   start of the command, or just after a chain separator
//   \s*cd\s+        the `cd` itself
//   (["']?)         an optional opening quote, captured so \1 can match it
//   ([^\s"'&;|]+)   the directory: no whitespace, quotes, or chain separators
//   \1              the same quote style it opened with, or nothing
const CD_TARGET_RE = /(?:^|&&|;|\n)\s*cd\s+(["']?)([^\s"'&;|]+)\1/g

/**
 * Directories a command might stage from: every `cd` target in the command,
 * plus the agent-provided project root when set. `process.cwd()` is
 * deliberately NOT consulted — a hook may be invoked from any directory, so it
 * would be a guess rather than an answer.
 */
export function candidateDirs(command: string): string[] {
  const out: string[] = []
  const projectDir = process.env['CLAUDE_PROJECT_DIR']
  if (projectDir) {
    out.push(projectDir)
  }
  for (const m of command.matchAll(CD_TARGET_RE)) {
    const dir = m[2]
    if (dir) {
      out.push(dir)
    }
  }
  return out
}

/**
 * True when a segment is a BROAD `git add` — one that stages by traversal
 * rather than by named path. `git add <explicit paths>` is not broad, because
 * the caller has said exactly what they mean.
 */
export function isBroadGitAdd(rest: readonly string[]): boolean {
  return rest.some(a => a === '--all' || a === '-A' || a === ':/' || a === '.')
}

// Tokenize the command on whitespace; split on `&&`/`||`/`;`/`|` so we
// don't merge chained commands. The git invocation may be wrapped by
// env-var assignments (`FOO=bar git add ...`).
export function findGitAddForceInvocations(command: string): string[][] {
  const out: string[][] = []
  const segments = command.split(/(?:&&|;|\n|\|\|)/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    const tokens = segment.trim().split(/\s+/)
    // `j` for the inner cursor — outer loop already owns `i`.
    let j = 0
    while (j < tokens.length && tokens[j]!.includes('=')) {
      j += 1
    }
    if (tokens[j] !== 'git') {
      continue
    }
    if (tokens[j + 1] !== 'add') {
      continue
    }
    const rest = tokens.slice(j + 2)
    const hasForce = rest.some(arg => arg === '--force' || arg === '-f')
    if (!hasForce && !isBroadGitAdd(rest)) {
      continue
    }
    out.push(rest)
  }
  return out
}

export function isForbiddenPath(arg: string): boolean {
  // `-f` / `--force` are flag-only, not paths.
  if (arg.startsWith('-')) {
    return false
  }
  // Strip quotes.
  const stripped = arg.replace(/^["']|["']$/g, '')
  // Any `/node_modules/` segment OR a top-level `node_modules` /
  // `node_modules/...`.
  if (
    /(?:^|\/)node_modules(?:\/|$)/.test(stripped) ||
    /[\\]node_modules(?:[\\]|$)/.test(stripped)
  ) {
    return true
  }
  // `package-lock.json` under `.claude/hooks/<name>/` or
  // `.claude/skills/<name>/`.
  if (
    /(?:^|\/)\.claude\/(?:hooks|skills)\/[^/]+\/(?:package-lock\.json|pnpm-lock\.yaml)$/.test(
      stripped,
    )
  ) {
    return true
  }
  return false
}

export const check = bashGuard(command => {
  const forced = findGitAddForceInvocations(command)
  if (forced.length === 0) {
    return undefined
  }

  const blockedArgs: string[] = []
  for (let i = 0, { length } = forced; i < length; i += 1) {
    const restArgs = forced[i]!
    for (let j = 0, { length: len } = restArgs; j < len; j += 1) {
      const arg = restArgs[j]!
      if (isForbiddenPath(arg)) {
        blockedArgs.push(arg)
      }
    }
  }
  // A broad add names no path, so `blockedArgs` is empty and the force branch
  // below never sees it. Judge it on the TREE instead: if a `node_modules`
  // symlink is sitting in a directory this command could stage from, the add
  // will take it.
  if (blockedArgs.length === 0) {
    const broad = forced.some(rest => isBroadGitAdd(rest))
    if (!broad) {
      return undefined
    }
    const dirs = candidateDirs(command).filter(nodeModulesIsSymlink)
    if (dirs.length === 0) {
      return undefined
    }
    return block(
      [
        '[node-modules-staging-guard] Blocked: broad `git add` with a node_modules SYMLINK present',
        '',
        '  Symlinked node_modules found in:',
        ...dirs.map(d => `    ${d}`),
        '',
        '  A worktree gets this link so the fleet tooling resolves. Git sees a',
        '  symlink as a FILE, so a `node_modules/` ignore rule (trailing slash,',
        '  directory-only) misses it and the broad add stages the link. In CI',
        '  the target does not exist, so the dangling link throws ENOENT and the',
        '  install dies before a single check runs.',
        '',
        '  Do one of these instead:',
        '    - stage explicit paths: git add <path> [<path>...]',
        '    - or exclude it locally first, then re-run:',
        '        echo node_modules >> "$(git rev-parse --git-dir)/info/exclude"',
        '',
      ].join('\n'),
    )
  }

  return block(
    [
      '[node-modules-staging-guard] Blocked: `git add -f` of node_modules / hook lockfile',
      '',
      '  Forbidden paths in the command:',
      ...blockedArgs.map(a => `    ${a}`),
      '',
      '  Past incident: a cascading agent committed',
      '  `.claude/hooks/fleet/check-new-deps/node_modules/` into 6 fleet repos.',
      '  Removing it required force-push (itself a hazard) or filter-branch.',
      '',
      '  `node_modules/` and hook `package-lock.json` files are gitignored',
      '  INTENTIONALLY. Each consumer runs its own `pnpm install` against',
      '  the package.json that did land in the commit.',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['node-modules-staging'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
