#!/usr/bin/env node
/**
 * @file Fleet cascade — propagate a socket-wheelhouse/template/ SHA to every
 *   fleet repo. Uses the FLEET_SYNC=1 sentinel to bypass the no-revert-guard /
 *   overeager-staging-guard hooks without per-repo Allow-bypass phrases.
 *
 *   Replaces the original cascade-template.sh; the fleet convention is `.mts`
 *   for all runners.
 *
 * Usage:
 *   node .claude/skills/cascading-fleet/lib/cascade-template.mts <template-sha>
 *
 * Reads the canonical fleet-repo list from `<this-dir>/fleet-repos.txt`. Each
 * repo's worktree is created off `origin/<default-branch>`, the wheelhouse
 * sync-scaffolding CLI runs, the resulting changes are committed, and the
 * script tries a direct push first, falling back to opening a PR on rejection.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

const LOG_PATH_PREFIX = '/tmp/cascade-'

function usage(): never {
  logger.error(`usage: ${process.argv[1]} <template-sha>`)
  process.exit(2)
}

const TEMPLATE_SHA = process.argv[2]
if (!TEMPLATE_SHA) {
  usage()
}

const SCRIPT_DIR = import.meta.dirname
const FLEET_REPOS_FILE = path.join(SCRIPT_DIR, 'fleet-repos.txt')
const PROJECTS = process.env['PROJECTS'] || path.join(homedir(), 'projects')
// socket-hook: allow cross-repo
const WH_SCRIPT = path.join(PROJECTS, 'socket-wheelhouse', 'scripts', 'sync-scaffolding', 'cli.mts')
// socket-hook: allow cross-repo
const CLEANUP_SCRIPT = path.join(PROJECTS, 'socket-wheelhouse', 'scripts', 'cascade-tooling', 'cleanup-stranded.mts')

// Prepend the active Node version's bin dir to PATH so the `node` invoked by
// the wheelhouse CLI matches the operator's expected toolchain (avoids the
// pre-commit hook's "wrong Node" fallback). Honors NVM_BIN when set; otherwise
// leaves PATH alone so a Volta / homebrew / system Node still resolves.
if (process.env['NVM_BIN']) {
  process.env['PATH'] = `${process.env['NVM_BIN']}:${process.env['PATH'] || ''}`
}

if (!existsSync(FLEET_REPOS_FILE)) {
  logger.error(`fleet-repos.txt not found at ${FLEET_REPOS_FILE}`)
  process.exit(2)
}
if (!existsSync(WH_SCRIPT)) {
  logger.error(`wheelhouse sync-scaffolding CLI not found at ${WH_SCRIPT}`)
  logger.error('set PROJECTS=<dir containing socket-wheelhouse> before retrying')
  process.exit(2)
}
// CLEANUP_SCRIPT is optional — older wheelhouse checkouts won't have it.
// When missing, skip auto-cleanup; the cascade still runs.

const LOG_FILE = `${LOG_PATH_PREFIX}${TEMPLATE_SHA}.log`
writeFileSync(LOG_FILE, '')

function log(line: string): void {
  logger.info(line)
  appendFileSync(LOG_FILE, `${line}\n`)
}

const RESULTS: string[] = []

log(`══ Cascade ${TEMPLATE_SHA} ══`)
log(`Log: ${LOG_FILE}`)
log('')

// Resolve a canonical fleet repo name to a local primary checkout. Mirrors
// scripts/sync-scaffolding/discover.mts directoryAliasesFor(): canonical
// `socket-<x>` also resolves to `${PROJECTS}/<x>/`; canonical `<x>` (no
// socket- prefix — sdxgen, stuie, ultrathink) also resolves to
// `${PROJECTS}/socket-<x>/`. First primary checkout wins. Returns undefined
// when no primary checkout exists.
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

type RunResult = {
  status: number
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() }): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function logTail(out: string, n: number): void {
  const lines = out.split('\n').filter(Boolean)
  for (const line of lines.slice(-n)) {
    log(line)
  }
}

function git(cwd: string, args: string[]): RunResult {
  return run('git', args, { cwd })
}

function gitSilent(cwd: string, args: string[]): void {
  // Used for best-effort cleanup that should not pollute output on failure
  // (mirrors `2>/dev/null` in the original bash).
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' })
  } catch {
    // Intentional: cleanup failures are non-fatal.
  }
}

function resolveBase(src: string): string {
  const sym = git(src, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (sym.status === 0) {
    return sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
  }
  for (const candidate of ['main', 'master']) {
    if (git(src, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${candidate}`]).status === 0) {
      return candidate
    }
  }
  return 'main'
}

const fleetReposRaw = readFileSync(FLEET_REPOS_FILE, 'utf8').split('\n')

for (const rawLine of fleetReposRaw) {
  const repo = rawLine.trim()
  if (!repo || repo.startsWith('#')) {
    continue
  }

  const src = resolveLocalCheckout(repo)
  const wt = path.join('/tmp', `cascade-${repo}-${process.pid}`)
  log(`── ${repo} ──`)

  if (!src) {
    RESULTS.push(`${repo}|skip:no-git`)
    continue
  }

  const base = resolveBase(src)
  git(src, ['fetch', 'origin', base, '--quiet'])

  // Auto-clean stranded cascade artifacts from earlier waves. Safety rails
  // inside the script bail the repo (no-op) if anything looks ambiguous;
  // only removes commits matching the cascade subject regex, authored by a
  // trusted identity, touching only cascade-allowlisted files, and whose
  // template SHA strictly precedes origin's current cascade SHA.
  if (existsSync(CLEANUP_SCRIPT)) {
    const cleanup = run('node', [CLEANUP_SCRIPT, '--target', src], { cwd: src })
    logTail(cleanup.stdout + cleanup.stderr, 3)
  }

  const branch = `chore/sync-${TEMPLATE_SHA}`

  gitSilent(src, ['worktree', 'remove', '--force', wt])
  gitSilent(src, ['branch', '-D', branch])

  const wtAdd = git(src, ['worktree', 'add', '-b', branch, wt, `origin/${base}`])
  if (wtAdd.status !== 0) {
    logTail(wtAdd.stdout + wtAdd.stderr, 1)
    RESULTS.push(`${repo}|fail:worktree`)
    continue
  }
  logTail(wtAdd.stdout + wtAdd.stderr, 1)

  const sync = run('node', [WH_SCRIPT, '--target', wt, '--fix'], { cwd: wt })
  logTail(sync.stdout + sync.stderr, 3)

  const aheadOut = git(wt, ['rev-list', '--count', `origin/${base}..HEAD`])
  const ahead = aheadOut.status === 0 ? parseInt(aheadOut.stdout.trim(), 10) || 0 : 0
  if (ahead === 0) {
    const dirty = git(wt, ['status', '--porcelain']).stdout.trim()
    if (!dirty) {
      RESULTS.push(`${repo}|noop`)
      gitSilent(src, ['worktree', 'remove', '--force', wt])
      gitSilent(src, ['branch', '-D', branch])
      continue
    }
    // FLEET_SYNC=1 + CI=true env is required: the sentinel allowlists exactly
    // this commit through the no-revert-guard / overeager-staging-guard
    // hooks. CI=true suppresses interactive pre-commit hook prompts.
    const stageEnv = { ...process.env, FLEET_SYNC: '1', CI: 'true' }
    git(wt, ['add', '--update'])
    const commit = run('git', [
      'commit',
      '--no-verify',
      '-m',
      `chore(sync): cascade fleet template@${TEMPLATE_SHA}`,
    ], { cwd: wt, env: stageEnv })
    logTail(commit.stdout + commit.stderr, 2)
    if (commit.status !== 0) {
      RESULTS.push(`${repo}|fail:commit`)
      gitSilent(src, ['worktree', 'remove', '--force', wt])
      gitSilent(src, ['branch', '-D', branch])
      continue
    }
  }

  const pushEnv = { ...process.env, FLEET_SYNC: '1' }
  const push = run('git', ['push', '--no-verify', 'origin', `HEAD:${base}`], { cwd: wt, env: pushEnv })
  logTail(push.stdout + push.stderr, 2)
  if (push.status === 0) {
    RESULTS.push(`${repo}|push:${base}`)
  } else {
    const branchPush = run('git', ['push', '--no-verify', '-u', 'origin', branch], { cwd: wt, env: pushEnv })
    logTail(branchPush.stdout + branchPush.stderr, 2)
    if (branchPush.status === 0) {
      const prCreate = run('gh', [
        'pr', 'create',
        '--repo', `SocketDev/${repo}`,
        '--base', base,
        '--head', branch,
        '--title', `chore(sync): cascade fleet template@${TEMPLATE_SHA}`,
        '--body', `Auto-cascade of socket-wheelhouse@${TEMPLATE_SHA}.`,
      ], { cwd: wt })
      const prUrl = (prCreate.stdout + prCreate.stderr).trim().split('\n').filter(Boolean).slice(-1)[0] ?? ''
      RESULTS.push(`${repo}|pr:${prUrl}`)
    } else {
      RESULTS.push(`${repo}|fail:push+pr`)
    }
  }

  gitSilent(src, ['worktree', 'remove', '--force', wt])
  gitSilent(src, ['branch', '-D', branch])
}

log('')
log('════ RESULTS ════')
for (const entry of RESULTS) {
  log(`  ${entry}`)
}
