// Fleet-wide conservative junk + stray-scratch file sweep.
//
// Deletes only never-wanted files (OS cruft, editor backups, build stragglers)
// and stray AI/temp scratch (orphaned /tmp cascade dirs, dry-run logs). NEVER
// touches a git-tracked file: every candidate is verified untracked-or-ignored
// before removal. This is the low-friction "care and feeding" sweep — safe to
// run unattended (e.g. on a /loop), no prompting, conservative by construction.
//
// Generalizes the single-file `sweep-ds-store` Stop hook (which removes only
// `.DS_Store`, edit-time) into a fleet-wide, multi-pattern engine. The hook
// stays as the in-session complement; this is the periodic sweep.
//
// Default is --dry-run (report only). Pass --fix to delete.
//
// Usage:
//   node tidy-files.mts            # dry-run: report what WOULD be deleted
//   node tidy-files.mts --fix      # delete junk fleet-wide
//   node tidy-files.mts --fix --repo socket-cli   # restrict to one repo

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

// 1 path, 1 reference: the roster + its reader live in one shared owner.
import { readRoster } from '../../_shared/scripts/fleet-roster.mts'

const logger = getDefaultLogger()

const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

export { readRoster }

// Directories never worth descending into during the sweep — huge, or owned by
// tooling that manages its own cleanup.
export const SKIP_DIRS = new Set<string>([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.pnpm-store',
])

// Exact basenames that are never wanted in a repo.
export const JUNK_BASENAMES = new Set<string>([
  '.DS_Store',
  '.DS_Store?',
  '._.DS_Store',
  'Thumbs.db',
  'ehthumbs.db',
  'Desktop.ini',
  '.Spotlight-V100',
  '.Trashes',
])

// Suffixes that mark editor / merge / build stragglers.
export const JUNK_SUFFIXES = [
  '.orig',
  '.rej',
  '.swp',
  '.swo',
  '.pyc',
  '.pyo',
] as const

/**
 * True when a basename is never-wanted junk: an exact junk name, a tilde-backup
 * (`foo~`), a `.DS_Store` variant, or a junk suffix. Pure + total — the unit of
 * the sweep's decision, tested directly.
 */
export function isJunkBasename(name: string): boolean {
  if (JUNK_BASENAMES.has(name)) {
    return true
  }
  if (name.endsWith('~') && name.length > 1) {
    return true
  }
  // `.DS_Store` sometimes appears with trailing variants on network volumes.
  if (name.startsWith('.DS_Store')) {
    return true
  }
  for (let i = 0, { length } = JUNK_SUFFIXES; i < length; i += 1) {
    if (name.endsWith(JUNK_SUFFIXES[i]!)) {
      return true
    }
  }
  return false
}

/**
 * True when `absPath` is safe to delete: NOT tracked by git AND not inside a
 * submodule. The sweep deletes only untracked junk in the repo's own tree — a
 * tracked file matching a junk pattern is a deliberate fixture, and a path
 * inside a submodule belongs to that submodule's own git (deleting it would
 * dirty the submodule). Fails closed: any check error → treat as unsafe
 * (keep).
 */
export async function isSafeToDelete(
  repoDir: string,
  absPath: string,
): Promise<boolean> {
  const result = await spawn('git', ['ls-files', '--error-unmatch', absPath], {
    cwd: repoDir,
    stdioString: true,
  }).then(
    () => ({ tracked: true, stderr: '' }),
    (e: unknown) => ({
      tracked: false,
      stderr: String((e as { stderr?: string })?.stderr ?? ''),
    }),
  )
  if (result.tracked) {
    return false
  }
  // "is in submodule" → the path is the submodule's to manage, never ours.
  if (/is in submodule/i.test(result.stderr)) {
    return false
  }
  return true
}

export function walkForJunk(root: string): string[] {
  const found: string[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      const full = path.join(dir, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (name === '__pycache__') {
          found.push(full)
          continue
        }
        if (!SKIP_DIRS.has(name)) {
          stack.push(full)
        }
        continue
      }
      if (isJunkBasename(name)) {
        found.push(full)
      }
    }
  }
  return found
}

export interface RepoFilesResult {
  repo: string
  deleted: string[]
  missing: boolean
}

export async function tidyRepoFiles(
  repo: string,
  options: { fix: boolean },
): Promise<RepoFilesResult> {
  const repoDir = path.join(PROJECTS, repo)
  if (!existsSync(path.join(repoDir, '.git'))) {
    return { repo, deleted: [], missing: true }
  }
  const candidates = walkForJunk(repoDir)
  const deleted: string[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    const safe = await isSafeToDelete(repoDir, candidate)
    if (!safe) {
      continue
    }
    if (options.fix) {
      const ok = await safeDelete(candidate).then(
        () => true,
        () => false,
      )
      if (ok) {
        deleted.push(candidate)
      }
    } else {
      deleted.push(candidate)
    }
  }
  return { repo, deleted, missing: false }
}

/**
 * Stray temp scratch in the OS tmp dir that the fleet's own tooling leaves
 * behind: cascade worktree dirs and dry-run logs. These live OUTSIDE any repo,
 * so they're swept by name pattern, not git-tracked status.
 */
export function findStrayTmp(tmpDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(tmpDir)
  } catch {
    return []
  }
  const out: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (
      name.startsWith('cascade-') ||
      /-dryrun.*\.log$/.test(name) ||
      /^wh-(dryrun|livewave|socketlib).*\.log$/.test(name)
    ) {
      out.push(path.join(tmpDir, name))
    }
  }
  return out
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const repoIdx = process.argv.indexOf('--repo')
  const onlyRepo = repoIdx !== -1 ? process.argv[repoIdx + 1] : undefined

  const roster = onlyRepo ? [onlyRepo] : readRoster()
  const mode = fix ? 'FIX' : 'DRY-RUN'
  logger.info(`tidy-files (${mode}) — ${roster.length} repo(s)`)

  let total = 0
  for (let i = 0, { length } = roster; i < length; i += 1) {
    const repo = roster[i]!
    const result = await tidyRepoFiles(repo, { fix })
    if (result.missing || !result.deleted.length) {
      continue
    }
    total += result.deleted.length
    const verb = fix ? 'deleted' : 'would delete'
    logger.info(`── ${repo} (${result.deleted.length}) ──`)
    for (let j = 0, n = Math.min(result.deleted.length, 20); j < n; j += 1) {
      logger.info(`  - ${verb} ${result.deleted[j]}`)
    }
    if (result.deleted.length > 20) {
      logger.info(`  … and ${result.deleted.length - 20} more`)
    }
  }

  // Stray tmp scratch (only when sweeping the whole fleet, not a single repo).
  if (!onlyRepo) {
    const stray = findStrayTmp(os.tmpdir())
    if (stray.length) {
      total += stray.length
      logger.info(`── /tmp scratch (${stray.length}) ──`)
      for (let j = 0, n = stray.length; j < n; j += 1) {
        const target = stray[j]!
        if (fix) {
          await safeDelete(target).catch(() => undefined)
        }
        logger.info(`  - ${fix ? 'deleted' : 'would delete'} ${target}`)
      }
    }
  }

  if (total === 0) {
    logger.success('tidy-files: nothing to tidy — no junk found.')
  } else if (fix) {
    logger.success(`tidy-files: deleted ${total} junk file(s)/dir(s).`)
  } else {
    logger.info(
      `tidy-files: ${total} junk file(s)/dir(s) would be deleted. Re-run with --fix to act.`,
    )
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    await main()
  })()
}
