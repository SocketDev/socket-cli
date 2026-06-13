#!/usr/bin/env node
/**
 * @file Reconcile + push `pnpm-lock.yaml` across the fleet after a cascade wave
 *   that landed catalog / dependency changes but committed WITHOUT the lockfile
 *   (the cascade excludes a stale lockfile when its `pnpm install` can't
 *   reconcile — e.g. a wrong-pnpm-on-PATH subprocess). Per fleet repo:
 *
 *   1. Worktree off `origin/<base>` (which has the cascade commit).
 *   2. `pnpm install` to regenerate the lockfile against the new catalog.
 *   3. If the lockfile changed: commit `chore(wheelhouse): reconcile
 *      pnpm-lock.yaml after cascade` (FLEET_SYNC sentinel) + push direct.
 *   4. Force-clean the worktree. Runs under the same FLEET_SYNC=1 sentinel as
 *      cascade-template: the no-revert-guard / overeager-staging-guard hooks
 *      allowlist the `--no-verify` commit/push when the message starts with
 *      `chore(wheelhouse):`. Reuses the roster + checkout-resolution from the
 *      sibling cascade. Idempotent: a repo whose lockfile is already current
 *      reports `noop`. Usage: node .../reconcile-lockfiles.mts [--skip
 *      <repo>[,<repo>…]]
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const ARGV = process.argv.slice(2)
const SKIP_REPOS = new Set<string>()
for (let i = 0, { length } = ARGV; i < length; i += 1) {
  if (ARGV[i] === '--skip' && ARGV[i + 1]) {
    for (const r of ARGV[i + 1]!.split(',')) {
      const name = r.trim()
      if (name) {
        SKIP_REPOS.add(name)
      }
    }
  }
}

const SCRIPT_DIR = import.meta.dirname
const FLEET_REPOS_FILE = path.join(SCRIPT_DIR, 'fleet-repos.txt')
const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

// Prepend the RUNNING node's own bin dir so spawned `pnpm` resolves the same
// toolchain that launched this script. Do NOT use NVM_BIN — it can point at a
// different Node whose corepack-managed pnpm is an OLD version (e.g. v22's
// pnpm 11.0.0), which then fails the repo's `packageManager: pnpm@11.5.x`
// version check and aborts `pnpm install`.
const NODE_BIN_DIR = path.dirname(process.execPath)
process.env['PATH'] = `${NODE_BIN_DIR}:${process.env['PATH'] || ''}`

if (!existsSync(FLEET_REPOS_FILE)) {
  logger.error(`fleet-repos.txt not found at ${FLEET_REPOS_FILE}`)
  process.exit(2)
}

type RunResult = { status: number; stdout: string; stderr: string }

function run(
  cmd: string,
  args: string[],
  opts: {
    cwd: string
    env?: NodeJS.ProcessEnv | undefined
    timeoutMs?: number | undefined
  },
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    // A wedged install (Socket Firewall proxy contention on a large repo) would
    // otherwise hang the reconcile for hours; cap it. SIGTERM on timeout.
    timeout: opts.timeoutMs,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function git(cwd: string, args: string[]): RunResult {
  return run('git', args, { cwd })
}

function gitSilent(cwd: string, args: string[]): void {
  spawnSync('git', args, { cwd, stdio: 'ignore' })
}

// True when a process with `pid` is alive. `kill(pid, 0)` sends no signal but
// throws ESRCH if the pid is dead — the standard liveness probe.
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Sweep stale reconcile worktrees left by a PRIOR run that was killed or whose
// `pnpm install` wedged before the self-cleaning `worktree remove` ran (a large
// monorepo's install can run for minutes; a timeout / Ctrl-C orphans the tmp
// worktree, which then blocks `worktree add` and accumulates). Each worktree is
// named `reconcile-<repo>-<pid>`; remove any whose pid is neither this process
// nor a live one. Runs once at startup, per repo we're about to touch.
function sweepStaleReconcileWorktrees(src: string, repo: string): void {
  const list = git(src, ['worktree', 'list', '--porcelain'])
  if (list.status !== 0) {
    return
  }
  const prefix = `reconcile-${repo}-`
  for (const line of list.stdout.split('\n')) {
    if (!line.startsWith('worktree ')) {
      continue
    }
    const wtPath = line.slice('worktree '.length).trim()
    const name = path.basename(wtPath)
    if (!name.startsWith(prefix)) {
      continue
    }
    const pid = Number(name.slice(prefix.length))
    if (Number.isInteger(pid) && pid !== process.pid && !pidAlive(pid)) {
      logger.warn(
        `  sweeping stale reconcile worktree: ${wtPath} (pid ${pid} dead)`,
      )
      gitSilent(src, ['worktree', 'remove', '--force', wtPath])
      gitSilent(src, ['worktree', 'prune'])
    }
  }
}

function resolveLocalCheckout(canonical: string): string | undefined {
  let candidate = path.join(PROJECTS, canonical)
  if (existsSync(path.join(candidate, '.git'))) {
    return candidate
  }
  candidate = canonical.startsWith('socket-')
    ? path.join(PROJECTS, canonical.slice('socket-'.length))
    : path.join(PROJECTS, `socket-${canonical}`)
  if (existsSync(path.join(candidate, '.git'))) {
    return candidate
  }
  return undefined
}

function resolveBase(src: string): string {
  const sym = git(src, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (sym.status === 0) {
    return sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
  }
  for (const candidate of ['main', 'master']) {
    if (
      git(src, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${candidate}`,
      ]).status === 0
    ) {
      return candidate
    }
  }
  return 'main'
}

const RESULTS: string[] = []
const fleetReposRaw = readFileSync(FLEET_REPOS_FILE, 'utf8').split('\n')

for (const rawLine of fleetReposRaw) {
  const repo = rawLine.trim()
  if (!repo || repo.startsWith('#')) {
    continue
  }
  if (SKIP_REPOS.has(repo)) {
    RESULTS.push(`${repo}|skip:requested`)
    continue
  }
  const src = resolveLocalCheckout(repo)
  if (!src) {
    RESULTS.push(`${repo}|skip:no-git`)
    continue
  }
  logger.info(`── ${repo} ──`)
  // Clear any orphan worktree a prior killed/wedged run left behind before we
  // add ours (otherwise `worktree add` fails and they pile up).
  sweepStaleReconcileWorktrees(src, repo)
  const base = resolveBase(src)
  git(src, ['fetch', 'origin', base, '--quiet'])
  const wt = path.join(os.tmpdir(), `reconcile-${repo}-${process.pid}`)
  gitSilent(src, ['worktree', 'remove', '--force', wt])

  const wtAdd = git(src, ['worktree', 'add', '-q', wt, `origin/${base}`])
  if (wtAdd.status !== 0) {
    RESULTS.push(`${repo}|fail:worktree`)
    continue
  }

  // Lockfile-only first: this resolves the lockfile WITHOUT the fetch/link
  // phase, so it's near-instant and never touches the Socket Firewall proxy
  // (the phase that wedges on a large repo). If it reports the lockfile is
  // already current, the full install is unnecessary — most repos after a
  // cascade are exactly this case. 2-minute cap as a backstop.
  const probe = run('pnpm', ['install', '--lockfile-only'], {
    cwd: wt,
    timeoutMs: 2 * 60 * 1000,
  })
  const lockChanged = git(wt, ['status', '--porcelain', '--', 'pnpm-lock.yaml'])
  if (probe.status === 0 && lockChanged.stdout.trim() === '') {
    // Lockfile already current — nothing to reconcile. Don't run the full
    // (proxy-bound, wedge-prone) install at all.
    RESULTS.push(`${repo}|noop:lockfile-current`)
    gitSilent(src, ['worktree', 'remove', '--force', wt])
    continue
  }

  // Lockfile drifted (or the probe couldn't decide) — do the full install to
  // materialize it, but cap it so a proxy wedge can't hang the reconcile.
  const install = run(
    'pnpm',
    ['install', '--config.confirmModulesPurge=false'],
    {
      cwd: wt,
      timeoutMs: 8 * 60 * 1000,
    },
  )
  if (install.status !== 0) {
    RESULTS.push(`${repo}|fail:install`)
    // Surface the real failure — an error message is UI; `fail:install` alone
    // forces the reader to reproduce the install by hand. Print the tail of
    // stderr (then stdout) so the cause (a missing export, a version-check
    // abort, a build-script crash, or a timeout) is visible in the RESULTS run.
    const detail = (install.stderr.trim() || install.stdout.trim()).slice(-1500)
    if (detail) {
      logger.error(`  pnpm install failed in ${repo}:`)
      logger.error(detail)
    }
    gitSilent(src, ['worktree', 'remove', '--force', wt])
    continue
  }

  const dirty = git(wt, [
    'status',
    '--porcelain',
    'pnpm-lock.yaml',
  ]).stdout.trim()
  if (!dirty) {
    RESULTS.push(`${repo}|noop:lockfile-current`)
    gitSilent(src, ['worktree', 'remove', '--force', wt])
    continue
  }

  const fleetEnv = { ...process.env, FLEET_SYNC: '1', CI: 'true' }
  git(wt, ['add', 'pnpm-lock.yaml'])
  const commit = run(
    'git',
    [
      'commit',
      '--no-verify',
      '-m',
      'chore(wheelhouse): reconcile pnpm-lock.yaml after cascade',
    ],
    { cwd: wt, env: fleetEnv },
  )
  if (commit.status !== 0) {
    RESULTS.push(`${repo}|fail:commit`)
    gitSilent(src, ['worktree', 'remove', '--force', wt])
    continue
  }
  const push = run('git', ['push', '--no-verify', 'origin', `HEAD:${base}`], {
    cwd: wt,
    env: fleetEnv,
  })
  RESULTS.push(push.status === 0 ? `${repo}|push:${base}` : `${repo}|fail:push`)
  gitSilent(src, ['worktree', 'remove', '--force', wt])
}

logger.info('')
logger.info('════ RESULTS ════')
for (let i = 0, { length } = RESULTS; i < length; i += 1) {
  logger.info(`  ${RESULTS[i]!}`)
}
