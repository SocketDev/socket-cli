#!/usr/bin/env node
/**
 * @file Fleet cascade — propagate a socket-wheelhouse/template/ SHA to every
 *   fleet repo. Uses the FLEET_SYNC=1 sentinel to bypass the no-revert-guard /
 *   overeager-staging-guard hooks without per-repo Allow-bypass phrases.
 *   Replaces the original cascade-template.sh; the fleet convention is `.mts`
 *   for all runners. Usage: node
 *   .claude/skills/cascading-fleet/lib/cascade-template.mts <template-sha>
 *   Reads the canonical fleet-repo list from `<this-dir>/fleet-repos.txt`. Each
 *   repo's worktree is created off `origin/<default-branch>`, the wheelhouse
 *   sync-scaffolding CLI runs, the resulting changes are committed, and the
 *   script tries a direct push first, falling back to opening a PR on
 *   rejection.
 */

// prefer-async-spawn: sync-required — cascade orchestrator runs
// sequentially across repos with exit-code gating; async would
// complicate the linear pipeline for no real concurrency win.
// prefer-spawn-over-execsync: same — top-level sync CLI flow.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const LOG_PATH_PREFIX = '/tmp/cascade-'

function usage(): never {
  logger.error(
    `usage: ${process.argv[1]} [--dry-run] [--skip <repo>[,<repo>…]] <template-sha>`,
  )
  process.exit(2)
}

const ARGV = process.argv.slice(2)
// --dry-run: worktree + sync + report what WOULD change, then clean up. No
// stranded-cleanup mutation, no commit, no push, no PR. Use it to surface
// per-repo errors / conflicts / dirty checkouts before a real cascade wave.
const DRY_RUN = ARGV.includes('--dry-run')
// --skip <repo>[,<repo>…] (repeatable): exclude repos from this wave — e.g. one
// with a live uncommitted session whose main shouldn't advance under it yet.
const SKIP_REPOS = new Set<string>()
for (let i = 0, { length } = ARGV; i < length; i += 1) {
  if (ARGV[i] === '--skip' && ARGV[i + 1]) {
    const rs = ARGV[i + 1]!.split(',')
    for (let j = 0, { length: jlen } = rs; j < jlen; j += 1) {
      const r = rs[j]!
      const name = r.trim()
      if (name) {
        SKIP_REPOS.add(name)
      }
    }
  }
}
const TEMPLATE_SHA = ARGV.find(a => !a.startsWith('-') && !SKIP_REPOS.has(a))
if (!TEMPLATE_SHA) {
  usage()
}

const SCRIPT_DIR = import.meta.dirname
const FLEET_REPOS_FILE = path.join(SCRIPT_DIR, 'fleet-repos.txt')
// The structured roster carries each member's GitHub owner. The .txt is bare
// names; owner (for a cross-org member like decmpfs) lives in the .json sibling.
const FLEET_REPOS_JSON = path.join(SCRIPT_DIR, 'fleet-repos.json')
const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

// Map bare repo name → GitHub owner (default 'SocketDev'). Only the gh-PR
// fallback below needs the owner — the worktree fetch/push use the local clone's
// own `origin`, already per-repo correct. Absent .json / entry / owner field ⇒
// 'SocketDev' (backward-compatible: existing entries carry no `owner`).
function loadOwnerMap(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const parsed = JSON.parse(readFileSync(FLEET_REPOS_JSON, 'utf8')) as {
      repos?:
        | Array<{ name?: string | undefined; owner?: string | undefined }>
        | undefined
    }
    for (const entry of parsed.repos ?? []) {
      if (typeof entry.name === 'string' && typeof entry.owner === 'string') {
        map.set(entry.name, entry.owner)
      }
    }
  } catch {
    // No / invalid .json — every repo defaults to SocketDev via ownerOf.
  }
  return map
}
const OWNER_MAP = loadOwnerMap()
function ownerOf(repo: string): string {
  return OWNER_MAP.get(repo) ?? 'SocketDev'
}
// socket-lint: allow cross-repo
const WH_SCRIPT = path.join(
  PROJECTS,
  'socket-wheelhouse',
  'scripts',
  'repo',
  'sync-scaffolding',
  'cli.mts',
)
// socket-lint: allow cross-repo
const CLEANUP_SCRIPT = path.join(
  PROJECTS,
  'socket-wheelhouse',
  'scripts',
  'fleet',
  'cleanup-stranded.mts',
)

// Prepend the RUNNING node's own bin dir so the `node` (and corepack-managed
// pnpm) spawned by the cascade matches the toolchain that launched this script.
// Do NOT use NVM_BIN — it can point at a DIFFERENT Node whose corepack pnpm is
// an old version (e.g. v22's pnpm 11.0.0), which then fails a downstream repo's
// `packageManager: pnpm@11.5.x` version check and makes the cascade's `pnpm
// install` abort — silently committing without the reconciled lockfile.
const NODE_BIN_DIR = path.dirname(process.execPath)
process.env['PATH'] = `${NODE_BIN_DIR}:${process.env['PATH'] || ''}`

if (!existsSync(FLEET_REPOS_FILE)) {
  logger.error(`fleet-repos.txt not found at ${FLEET_REPOS_FILE}`)
  process.exit(2)
}
if (!existsSync(WH_SCRIPT)) {
  logger.error(`wheelhouse sync-scaffolding CLI not found at ${WH_SCRIPT}`)
  logger.error(
    'set PROJECTS=<dir containing socket-wheelhouse> before retrying',
  )
  process.exit(2)
}
// CLEANUP_SCRIPT is optional — older wheelhouse checkouts won't have it.
// When missing, skip auto-cleanup; the cascade still runs.

// Preflight (skipped under --dry-run, which is the safe way to inspect a dirty
// tree). A cascade copies FROM the local wheelhouse template; sync-scaffolding
// SILENTLY SKIPS any fleet dir whose template source is git-dirty, so a wave
// run mid-edit lands a PARTIAL cascade downstream. And two concurrent cascades
// contend on the Socket Firewall proxy and wedge. Refuse both up front rather
// than produce a half-applied wave.
const WH_DIR = path.join(PROJECTS, 'socket-wheelhouse')
function preflightOrAbort(): void {
  if (DRY_RUN) {
    return
  }
  // (1) Template must be clean. Lockfiles are regenerable; ignore them.
  const status = spawnSync(
    'git',
    ['-C', WH_DIR, 'status', '--porcelain', '--', 'template/'],
    { encoding: 'utf8' },
  )
  const dirty = String(status.stdout ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !/pnpm-lock\.yaml$|pnpm-workspace\.yaml$/.test(l))
  if (dirty.length > 0) {
    logger.error(
      [
        '[cascade] Refusing to start: the wheelhouse template is dirty.',
        '',
        ...dirty.slice(0, 8).map(l => `  ${l}`),
        dirty.length > 8 ? `  …and ${dirty.length - 8} more` : '',
        '',
        '  The cascade copies FROM template/; a dirty fleet dir is SKIPPED,',
        '  landing a partial cascade downstream. Commit/stash the template',
        '  changes first (a parallel session may own them — wait for it), or',
        '  use --dry-run to inspect without mutating.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    process.exit(2)
  }
  // (2) No other cascade in flight (concurrent waves wedge on the sfw proxy).
  const ps = spawnSync('pgrep', ['-f', 'cascade-template\\.mts'], {
    encoding: 'utf8',
  })
  const others = String(ps.stdout ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(pid => Number(pid) !== process.pid)
  if (others.length > 0) {
    logger.error(
      [
        '[cascade] Refusing to start: another cascade-template run is active',
        `  (pid ${others.join(', ')}). Concurrent cascades contend on the`,
        '  Socket Firewall proxy and wedge. Wait for it to finish.',
      ].join('\n'),
    )
    process.exit(2)
  }
}
preflightOrAbort()

const LOG_FILE = `${LOG_PATH_PREFIX}${TEMPLATE_SHA}.log`
writeFileSync(LOG_FILE, '')

function log(line: string): void {
  logger.info(line)
  appendFileSync(LOG_FILE, `${line}\n`)
}

const RESULTS: string[] = []

log(`══ Cascade ${TEMPLATE_SHA}${DRY_RUN ? ' (DRY RUN)' : ''} ══`)
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

function run(
  cmd: string,
  args: string[],
  config: { cwd: string; env?: NodeJS.ProcessEnv | undefined },
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: config.cwd,
    env: config.env ?? process.env,
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
  const lineList = lines.slice(-n)
  for (let i = 0, { length } = lineList; i < length; i += 1) {
    const line = lineList[i]!
    log(line)
  }
}

function git(cwd: string, args: string[]): RunResult {
  return run('git', args, { cwd })
}

function gitSilent(cwd: string, args: string[]): void {
  // Used for best-effort cleanup that should not pollute output on failure
  // (mirrors `2>/dev/null` in the original bash).
  spawnSync('git', args, { cwd, stdio: 'ignore' })
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

const fleetReposRaw = readFileSync(FLEET_REPOS_FILE, 'utf8').split('\n')

for (let i = 0, { length } = fleetReposRaw; i < length; i += 1) {
  const rawLine = fleetReposRaw[i]!
  const repo = rawLine.trim()
  if (!repo || repo.startsWith('#')) {
    continue
  }
  if (SKIP_REPOS.has(repo)) {
    log(`── ${repo} ──`)
    RESULTS.push(`${repo}|skip:requested`)
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
  // template SHA strictly precedes origin's current cascade SHA. In dry-run we
  // pass --dry-run through so it REPORTS strandedness without mutating the
  // source repo.
  if (existsSync(CLEANUP_SCRIPT)) {
    const cleanupArgs = DRY_RUN
      ? [CLEANUP_SCRIPT, '--target', src, '--dry-run']
      : [CLEANUP_SCRIPT, '--target', src]
    const cleanup = run('node', cleanupArgs, { cwd: src })
    logTail(cleanup.stdout + cleanup.stderr, 3)
  }

  // Branch name reads `chore/wheelhouse-<sha>` — keeps the `chore/`
  // namespace convention and names the source explicitly. Replaces
  // the older `chore/sync-<sha>` form (no back-compat retained;
  // pre-rename stranded branches need a one-time hand cleanup).
  const branch = `chore/wheelhouse-${TEMPLATE_SHA}`

  gitSilent(src, ['worktree', 'remove', '--force', wt])
  gitSilent(src, ['branch', '-D', branch])

  const wtAdd = git(src, [
    'worktree',
    'add',
    '-b',
    branch,
    wt,
    `origin/${base}`,
  ])
  if (wtAdd.status !== 0) {
    logTail(wtAdd.stdout + wtAdd.stderr, 1)
    RESULTS.push(`${repo}|fail:worktree`)
    continue
  }
  logTail(wtAdd.stdout + wtAdd.stderr, 1)

  const sync = run('node', [WH_SCRIPT, '--target', wt, '--fix'], { cwd: wt })
  logTail(sync.stdout + sync.stderr, 3)

  // Exit code 3 means sync-scaffolding refused the cascade commit because
  // lockfile drift would have left the repo's pnpm-lock.yaml out of sync
  // with its package.json (downstream CI's --frozen-lockfile would then
  // reject the cascade commit). Bail the repo rather than push a known-
  // broken state — operator gets a clear `fail:lockfile-stale` row.
  if (sync.status === 3) {
    RESULTS.push(`${repo}|fail:lockfile-stale`)
    gitSilent(src, ['worktree', 'remove', '--force', wt])
    gitSilent(src, ['branch', '-D', branch])
    continue
  }

  // Dry-run: report what WOULD change, then tear down without pushing. The
  // sync-scaffolding `--fix` step COMMITS inside the worktree, so the change
  // lands as a commit ahead of origin/<base> (not as `status --porcelain`
  // dirt). Measure the real delta as `origin/<base>..HEAD` (committed) plus any
  // residual uncommitted dirt, and stat against origin/<base> so deletions
  // (removed/renamed files the REMOVED_FILES + dir-mirror sweep) show too.
  if (DRY_RUN) {
    const aheadOut = git(wt, ['rev-list', '--count', `origin/${base}..HEAD`])
    const ahead =
      aheadOut.status === 0 ? parseInt(aheadOut.stdout.trim(), 10) || 0 : 0
    const dirty = git(wt, ['status', '--porcelain']).stdout.trim()
    if (ahead === 0 && !dirty) {
      RESULTS.push(`${repo}|dry:noop`)
    } else {
      const stat = git(wt, ['diff', '--stat', `origin/${base}`]).stdout.trim()
      const fileCount = stat.split('\n').filter(l => l.includes('|')).length
      logTail(stat, 14)
      RESULTS.push(
        `${repo}|dry:would-change(${fileCount} file(s), ${ahead} commit(s))`,
      )
    }
    gitSilent(src, ['worktree', 'remove', '--force', wt])
    gitSilent(src, ['branch', '-D', branch])
    continue
  }

  const aheadOut = git(wt, ['rev-list', '--count', `origin/${base}..HEAD`])
  const ahead =
    aheadOut.status === 0 ? parseInt(aheadOut.stdout.trim(), 10) || 0 : 0
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
    const commit = run(
      'git',
      [
        'commit',
        '--no-verify',
        '-m',
        `chore(wheelhouse): cascade template@${TEMPLATE_SHA}`,
      ],
      { cwd: wt, env: stageEnv },
    )
    logTail(commit.stdout + commit.stderr, 2)
    if (commit.status !== 0) {
      RESULTS.push(`${repo}|fail:commit`)
      gitSilent(src, ['worktree', 'remove', '--force', wt])
      gitSilent(src, ['branch', '-D', branch])
      continue
    }
  }

  const pushEnv = { ...process.env, FLEET_SYNC: '1' }
  const push = run('git', ['push', '--no-verify', 'origin', `HEAD:${base}`], {
    cwd: wt,
    env: pushEnv,
  })
  logTail(push.stdout + push.stderr, 2)
  if (push.status === 0) {
    RESULTS.push(`${repo}|push:${base}`)
  } else {
    const branchPush = run(
      'git',
      ['push', '--no-verify', '-u', 'origin', branch],
      { cwd: wt, env: pushEnv },
    )
    logTail(branchPush.stdout + branchPush.stderr, 2)
    if (branchPush.status === 0) {
      const prCreate = run(
        'gh',
        [
          'pr',
          'create',
          '--repo',
          `${ownerOf(repo)}/${repo}`,
          '--base',
          base,
          '--head',
          branch,
          '--title',
          `chore(wheelhouse): cascade template@${TEMPLATE_SHA}`,
          '--body',
          `Auto-cascade of socket-wheelhouse@${TEMPLATE_SHA}.`,
        ],
        { cwd: wt },
      )
      const prUrl =
        (prCreate.stdout + prCreate.stderr)
          .trim()
          .split('\n')
          .filter(Boolean)
          .slice(-1)[0] ?? ''
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
for (let i = 0, { length } = RESULTS; i < length; i += 1) {
  const entry = RESULTS[i]!
  log(`  ${entry}`)
}
