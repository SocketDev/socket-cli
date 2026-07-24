/**
 * @file Fleet doctor — git hygiene probes (GAP 3/5/6/10). Runs the git
 *   commands doctor.mts needs to detect unsigned commits, a diverged default
 *   branch, removable cascade worktrees, and stranded cascade artifacts, then
 *   hands each raw output to the shared git-gap / stranded-cascade-gap
 *   detectors. The caller (doctor.mts main()) gates this whole phase behind
 *   --probe-git or --fix and only invokes it inside an actual git checkout.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import type { DoctorFinding } from './lib/doctor/catalog-gap.mts'
import {
  detectDivergedMain,
  detectRemovableWorktrees,
  detectUnsignedCommits,
} from './lib/doctor/git-gap.mts'
import {
  detectStrandedCascade,
  formatStrandedCascadeFinding,
} from './lib/doctor/stranded-cascade-gap.mts'

// True when the repo at `cwd` is on the `squash-history` cadence — its roster
// entry (`.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`) lists
// `squash-history` in `optIns`. Such a repo squashes local history and
// force-pushes over origin, so a diverged (behind > 0) local main is the
// intended state, not a defect. Resolves the repo name from the origin remote,
// falling back to the directory name. Any read/parse error yields false (the
// divergence probe then behaves as before).
function isSquashHistoryRepo(cwd: string): boolean {
  const rosterPath = path.join(
    cwd,
    '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
  )
  if (!existsSync(rosterPath)) {
    return false
  }
  let repoName = path.basename(cwd)
  const remoteR = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
    stdioString: true,
    timeout: 5000,
  })
  if (remoteR.status === 0 && typeof remoteR.stdout === 'string') {
    const slug = remoteR.stdout
      .trim()
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .pop()
    if (slug) {
      repoName = slug
    }
  }
  try {
    const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as {
      repos?:
        | Array<{ name?: string | undefined; optIns?: string[] | undefined }>
        | undefined
    }
    const entry = roster.repos?.find(r => r.name === repoName)
    return Boolean(entry?.optIns?.includes('squash-history'))
  } catch {
    return false
  }
}

// Resolve the default branch name for git probes. Falls back to 'main'.
function resolveDefaultBranch(cwd: string): string {
  const r = spawnSync(
    'git',
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    { cwd, stdioString: true, timeout: 10_000 },
  )
  if (r.status === 0 && typeof r.stdout === 'string') {
    const ref = r.stdout.trim()
    const slash = ref.lastIndexOf('/')
    return slash >= 0 ? ref.slice(slash + 1) : ref
  }
  return 'main'
}

// GAP 3/5/6/10: git hygiene probes — only when inside a git repo and either
// --probe-git is passed explicitly or --fix is active. These probes run git
// commands directly (spawnSync, no network) so they are gated behind an
// explicit flag to avoid surprising non-git invocations. --probe-git is the
// lightweight flag; --fix also enables them since a healthy install requires
// a healthy git state.
export function runGitHygieneProbes(config: {
  cwd: string
  doFix: boolean
  doProbeGit: boolean
}): DoctorFinding[] {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const findings: DoctorFinding[] = []
  const gitDir = path.join(cfg.cwd, '.git')
  if (!((cfg.doProbeGit || cfg.doFix) && existsSync(gitDir))) {
    return findings
  }
  const { cwd } = cfg
  const defaultBranch = resolveDefaultBranch(cwd)

  // GAP 5: unsigned commits on the default branch.
  const logR = spawnSync(
    'git',
    ['log', '--format=%H\t%G?', `origin/${defaultBranch}..HEAD`],
    { cwd, stdioString: true, timeout: 30_000 },
  )
  if (logR.status === 0 && typeof logR.stdout === 'string') {
    const unsignedFinding = detectUnsignedCommits(logR.stdout)
    if (unsignedFinding) {
      findings.push(unsignedFinding)
    }
  }

  // GAP 6: diverged default branch (behind > 0 vs origin, LOCAL ref only —
  // no network fetch; the ref may be stale but we never run git fetch here).
  const rlrR = spawnSync(
    'git',
    ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`],
    { cwd, stdioString: true, timeout: 30_000 },
  )
  if (rlrR.status === 0 && typeof rlrR.stdout === 'string') {
    const parts = rlrR.stdout.trim().split(/\s+/)
    const behind = parseInt(parts[0] ?? '0', 10)
    const ahead = parseInt(parts[1] ?? '0', 10)
    if (!Number.isNaN(behind) && !Number.isNaN(ahead)) {
      const divergedFinding = detectDivergedMain(ahead, behind, {
        squashHistory: isSquashHistoryRepo(cwd),
      })
      if (divergedFinding) {
        findings.push(divergedFinding)
      }
    }
  }

  // GAP 10: removable cascade worktrees.
  const wtR = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd,
    stdioString: true,
    timeout: 15_000,
  })
  if (wtR.status === 0 && typeof wtR.stdout === 'string') {
    const wtFinding = detectRemovableWorktrees(wtR.stdout)
    if (wtFinding) {
      findings.push(wtFinding)
    }
  }

  // GAP 3: stranded cascade artifacts (local-only cascade commits +
  // superseded cascade worktrees). Prefers cleanup-stranded --dry-run when
  // the wheelhouse-owned script is present (wheelhouse self-doctor). In fleet
  // members scripts/repo/ is not cascaded, so falls back to an inline git-log
  // grep that detects the same `chore(wheelhouse): cascade template@<sha>`
  // pattern without shelling to a path that does not exist. A missing script
  // that silently reports healthy is a fail-open violation of the
  // fail-LOUD rule (code-first-then-ai).
  const cleanupScriptPath = path.join(
    cwd,
    'scripts',
    'repo',
    'cleanup-stranded.mts',
  )
  if (existsSync(cleanupScriptPath)) {
    // Wheelhouse checkout: shell to the authoritative implementation.
    const strandedR = spawnSync(
      'node',
      ['scripts/repo/cleanup-stranded.mts', '--target', '.', '--dry-run'],
      { cwd, stdioString: true, timeout: 60_000 },
    )
    const strandedOut = [
      typeof strandedR.stdout === 'string' ? strandedR.stdout : '',
      typeof strandedR.stderr === 'string' ? strandedR.stderr : '',
    ]
      .join('\n')
      .trim()
    if (strandedOut) {
      const strandedFinding = detectStrandedCascade(strandedOut)
      if (strandedFinding) {
        findings.push(strandedFinding)
      }
    }
  } else {
    // Fleet member: cleanup-stranded.mts is wheelhouse-only. Run inline
    // detection via git log subject grep — equivalent to the plan step the
    // full script would run, without the destructive apply side.
    const logSubjectR = spawnSync(
      'git',
      ['log', '--format=%H\t%s', `origin/${defaultBranch}..HEAD`],
      { cwd, stdioString: true, timeout: 30_000 },
    )
    const strandedCommits: string[] = []
    if (logSubjectR.status === 0 && typeof logSubjectR.stdout === 'string') {
      const logLines = logSubjectR.stdout.split('\n')
      for (let i = 0, { length } = logLines; i < length; i += 1) {
        const trimmed = logLines[i]!.trim()
        if (
          trimmed &&
          /chore\(wheelhouse\): cascade template@[0-9a-f]+/.test(trimmed)
        ) {
          strandedCommits.push(trimmed)
        }
      }
    }
    // Reuse the worktree output already collected for GAP 10.
    const strandedWorktrees: string[] =
      wtR.status === 0 && typeof wtR.stdout === 'string'
        ? wtR.stdout
            .split('\n\n')
            .filter(block =>
              /branch refs\/heads\/chore\/wheelhouse-/.test(block),
            )
            .map(block => {
              const branchLine =
                block.match(/branch refs\/heads\/(.+)/)?.[1] ?? ''
              const pathLine = block.match(/worktree (.+)/)?.[1] ?? ''
              return `${branchLine}  ${pathLine}`
            })
            .filter(entry => entry.trim() !== '  ')
        : []
    if (strandedCommits.length > 0 || strandedWorktrees.length > 0) {
      findings.push(
        formatStrandedCascadeFinding({
          bailReason: undefined,
          strandedCommits,
          strandedWorktrees,
        }),
      )
    }
  }

  return findings
}
