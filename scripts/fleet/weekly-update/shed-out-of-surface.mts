/*
 * @file Shed out-of-surface changes before the weekly-update PR — CODE IS LAW
 *   for the gh-aw `allowed-files` contract. The weekly agent's update + fix
 *   wave can legitimately touch paths the workflow's `create_pull_request`
 *   safe output refuses (workflow `uses:` pin refreshes, a source edit made
 *   chasing a dep-break), and one such path kills the WHOLE PR — the 2026-07-28
 *   socket-lib weekly run died exactly this way, taking the dependency bumps
 *   down with it and stranding the downstream get-green fixer on a branch
 *   that was never created.
 *
 *   This mode reverts every changed path that falls outside the allowed-files
 *   globs back to the merge-base state, commits the reverts as one shed
 *   commit, and prints the shed list so the agent can surface it in the PR
 *   body as follow-up work. The allowed-files list is parsed from the
 *   workflow source itself, so the surface cannot drift from what gh-aw
 *   enforces.
 *
 *   Usage: node scripts/fleet/weekly-update.mts --shed-out-of-surface
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

/**
 * The `allowed-files:` glob entries from a gh-aw workflow source. Comment
 * lines inside the list are tolerated; the list ends at the first line that
 * is neither a comment nor a `- '<glob>'` entry.
 */
export function parseAllowedFileGlobs(markdown: string): string[] {
  const lines = markdown.split('\n')
  const globs: string[] = []
  let inList = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] as string
    if (!inList) {
      if (/^\s*allowed-files:\s*$/.test(line)) {
        inList = true
      }
      continue
    }
    const entry = /^\s*-\s*'(?<glob>[^']+)'\s*$/.exec(line)
    if (entry?.groups?.['glob']) {
      globs.push(entry.groups['glob'])
      continue
    }
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
      continue
    }
    break
  }
  return globs
}

/**
 * A matcher for the tiny glob dialect gh-aw allowed-files entries use:
 * `**` spans directories, `*` stays within one segment, everything else is
 * literal (dotfiles included). Local on purpose: the pinned lib's
 * `getGlobMatcher` throws from the bundled picomatch on every non-fast-path
 * call (the navigator define defect socket-lib fixed); swap to it once the
 * fleet pin carries that fix.
 */
export function surfaceGlobToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0, { length } = glob; i < length; i += 1) {
    const ch = glob[i] as string
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:.+/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    source += /[.+^${}()|[\]\\?]/.test(ch) ? `\\${ch}` : ch
  }
  return new RegExp(`^${source}$`)
}

/**
 * The changed paths that fall outside the allowed surface.
 */
export function outOfSurfacePaths(
  changed: readonly string[],
  globs: readonly string[],
): string[] {
  const matchers = globs.map(glob => surfaceGlobToRegExp(glob))
  return changed.filter(changedPath => {
    for (let i = 0, { length } = matchers; i < length; i += 1) {
      if (matchers[i]?.test(changedPath)) {
        return false
      }
    }
    return true
  })
}

async function git(args: readonly string[]): Promise<string> {
  const result = await spawn('git', [...args], {
    cwd: REPO_ROOT,
    stdioString: true,
  })
  return String(result.stdout ?? '').trim()
}

async function gitOk(args: readonly string[]): Promise<boolean> {
  try {
    await spawn('git', [...args], { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Revert every out-of-surface change back to the merge-base, commit the
 * reverts, and print the shed list. Exit contract: 0 with nothing to shed or
 * after a clean shed; throws (exit 1 via the caller) when the workflow
 * source or the base cannot be resolved.
 */
export async function shedOutOfSurface(): Promise<void> {
  const workflowSource = path.join(
    REPO_ROOT,
    '.github',
    'workflows',
    'weekly-update.md',
  )
  if (!existsSync(workflowSource)) {
    throw new Error(
      'shed-out-of-surface: workflow source not found.\n' +
        `  Where: ${workflowSource}\n` +
        '  Saw: no weekly-update.md; wanted the gh-aw source that declares allowed-files.\n' +
        '  Fix: run inside a repo that carries the weekly-update gh-aw workflow.',
    )
  }
  const globs = parseAllowedFileGlobs(readFileSync(workflowSource, 'utf8'))
  if (globs.length === 0) {
    throw new Error(
      'shed-out-of-surface: no allowed-files globs parsed.\n' +
        `  Where: ${workflowSource}\n` +
        '  Saw: an empty allowed-files list; wanted at least one glob.\n' +
        '  Fix: check the allowed-files block shape in the workflow source.',
    )
  }

  let defaultRef = await git([
    'symbolic-ref',
    '--quiet',
    'refs/remotes/origin/HEAD',
  ]).catch(() => '')
  if (!defaultRef) {
    defaultRef = (await gitOk(['rev-parse', '--verify', 'origin/main']))
      ? 'refs/remotes/origin/main'
      : 'refs/remotes/origin/master'
  }
  const base = await git(['merge-base', 'HEAD', defaultRef])

  const committed = await git(['diff', '--name-only', `${base}..HEAD`])
  const porcelain = await git(['status', '--porcelain'])
  const working = porcelain
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean)
  const changed = [...new Set([...committed.split('\n'), ...working])].filter(
    Boolean,
  )

  const shed = outOfSurfacePaths(changed, globs)
  if (shed.length === 0) {
    logger.success(
      'shed-out-of-surface: every change is inside the PR surface.',
    )
    return
  }

  for (let i = 0, { length } = shed; i < length; i += 1) {
    const shedPath = shed[i] as string
    const existsAtBase = await gitOk(['cat-file', '-e', `${base}:${shedPath}`])
    if (existsAtBase) {
      await spawn('git', ['checkout', base, '--', shedPath], {
        cwd: REPO_ROOT,
        stdio: 'ignore',
      })
    } else if (await gitOk(['ls-files', '--error-unmatch', shedPath])) {
      await spawn('git', ['rm', '-f', '-q', '--', shedPath], {
        cwd: REPO_ROOT,
        stdio: 'ignore',
      })
    } else {
      safeDeleteSync(path.join(REPO_ROOT, shedPath))
    }
  }
  await spawn('git', ['add', '-A', '--', ...shed], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  })
  const hasStaged = !(await gitOk(['diff', '--cached', '--quiet']))
  if (hasStaged) {
    await spawn(
      'git',
      [
        'commit',
        '-m',
        `chore(weekly): shed ${shed.length} out-of-surface change(s) from the PR\n\n${shed.map(p => `- ${p}`).join('\n')}`,
      ],
      { cwd: REPO_ROOT, stdio: 'ignore' },
    )
  }
  logger.warn(
    `shed-out-of-surface: reverted ${shed.length} path(s) outside the PR surface — list them in the PR body as follow-up work:`,
  )
  for (let i = 0, { length } = shed; i < length; i += 1) {
    logger.log(`  - ${shed[i]}`)
  }
}
