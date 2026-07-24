// Parsing helpers for version-bump-order-guard — recognizing a version-tag
// command, a bump commit's message, and the files that commit will write.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'

import { commandsFor } from '../_shared/shell-command.mts'

// `git tag <name>` (also `git tag -a`, `git tag -s`, etc.) creating a
// version tag (`vX.Y.Z`). Parser-based: a real `git` command with a
// `tag` arg and a version-shaped arg — so a quoted "git tag v1.2.3" in
// a message or a sibling command's string isn't a false trigger.
const VERSION_ARG_RE = /^v\d+\.\d+\.\d+$/
export function isVersionTagCommand(command: string): boolean {
  return commandsFor(command, 'git').some(
    c => c.args.includes('tag') && c.args.some(a => VERSION_ARG_RE.test(a)),
  )
}

// Subject patterns that count as a "bump commit". Matches Keep-a-
// Changelog style and Conventional Commits style.
export const BUMP_SUBJECT_RE =
  /^(?:chore(?:\([\w-]+\))?:\s+(?:bump version to|release)\s+v?\d+\.\d+\.\d+|chore(?:\([\w-]+\))?:\s+v?\d+\.\d+\.\d+\s+release)/i

// `git commit … -m "chore: bump version to X.Y.Z"` — the bump commit itself.
// Parser-based: a real `git commit` whose `-m`/`--message` value matches the
// bump-subject shape. The gate runs HERE too, not only at tag time, because the
// bump commit is the point a still-broken tree (accumulated lint debt) silently
// lands — by tag time it's already committed (and maybe pushed). A quoted
// "git commit" inside another command's string isn't a real invocation, so it
// won't trigger.
export function bumpCommitMessage(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    if (!c.args.includes('commit')) {
      continue
    }
    for (let i = 0, { length } = c.args; i < length; i += 1) {
      const arg = c.args[i]!
      // `-m <msg>` / `--message <msg>` (next arg) or `-m=<msg>` / `--message=<msg>`.
      let msg: string | undefined
      if ((arg === '--message' || arg === '-m') && i + 1 < length) {
        msg = c.args[i + 1]
      } else if (arg.startsWith('-m=')) {
        msg = arg.slice(3)
      } else if (arg.startsWith('--message=')) {
        msg = arg.slice('--message='.length)
      }
      if (msg && BUMP_SUBJECT_RE.test(msg.trim())) {
        return msg.trim()
      }
    }
  }
  return undefined
}

// A bump commit must carry BOTH package.json and CHANGELOG.md (the version
// delta + its public note land together — splitting them ships a release whose
// CHANGELOG lags the version, or vice versa).
const REQUIRED_BUMP_FILES = ['CHANGELOG.md', 'package.json'] as const

// `git commit` flags that consume the FOLLOWING token as their value — skipping
// their values keeps the pathspec scan from treating a `-m <msg>` message as a
// committed file.
const COMMIT_VALUE_FLAGS = new Set([
  '--author',
  '--cleanup',
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

// Explicit pathspecs on a `git commit` (`git commit -o a b -m …`,
// `git commit a b`, or anything after `--`). Empty when the commit names no
// paths (it'll commit whatever is staged instead).
function bumpCommitPaths(command: string): string[] {
  const out: string[] = []
  for (const c of commandsFor(command, 'git')) {
    const commitIdx = c.args.indexOf('commit')
    if (commitIdx < 0) {
      continue
    }
    let sawDashDash = false
    for (let i = commitIdx + 1, { length } = c.args; i < length; i += 1) {
      const arg = c.args[i]!
      if (sawDashDash) {
        out.push(arg)
        continue
      }
      if (arg === '--') {
        sawDashDash = true
        continue
      }
      if (arg.startsWith('-')) {
        if (COMMIT_VALUE_FLAGS.has(arg) && !arg.includes('=')) {
          i += 1
        }
        continue
      }
      out.push(arg)
    }
  }
  return out
}

// True when the commit stages all tracked changes (`-a` / `--all`), so the
// working-tree modifications join the staged set.
function commitStagesAll(command: string): boolean {
  return commandsFor(command, 'git').some(
    c =>
      c.args.includes('commit') &&
      (c.args.includes('-a') || c.args.includes('--all')),
  )
}

// Basenames of the files a bump commit will write: explicit pathspecs when the
// command names them, else the staged set (plus tracked modifications when
// `-a` stages them). Basenames so a monorepo path (`packages/x/package.json`)
// still matches a required bump-file name.
export function committedBumpBasenames(
  command: string,
  cwd: string,
): Set<string> {
  const paths: string[] = []
  const explicit = bumpCommitPaths(command)
  if (explicit.length) {
    paths.push(...explicit)
  } else {
    const staged = spawnSync('git', ['diff', '--cached', '--name-only'], {
      cwd,
    })
    if (staged.status === 0) {
      paths.push(...String(staged.stdout).split('\n'))
    }
    if (commitStagesAll(command)) {
      const tracked = spawnSync('git', ['diff', '--name-only'], { cwd })
      if (tracked.status === 0) {
        paths.push(...String(tracked.stdout).split('\n'))
      }
    }
  }
  const set = new Set<string>()
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const p = paths[i]!.trim()
    if (p) {
      set.add(path.basename(p))
    }
  }
  return set
}

// Which REQUIRED_BUMP_FILES are absent from the committed set.
export function missingBumpFiles(basenames: Set<string>): string[] {
  return REQUIRED_BUMP_FILES.filter(f => !basenames.has(f))
}
