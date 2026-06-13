#!/usr/bin/env node
/**
 * @file Tool-version layered-pin cascade orchestrator — the EXECUTABLE law for
 *   the "bump a core/security tool (pnpm, zizmor, sfw, …) and thread it through
 *   the fleet" procedure that the socket-registry `updating-workflows` SKILL
 *   describes in prose. Chains the existing pieces into one runnable command,
 *   with the CI-green gate enforced in code (not left to a human to remember).
 *   THE FLOW (and WHY this order — the dogfood-first-but-shared-CI nuance): the
 *   wheelhouse normally dogfoods itself first, but for CI it CONSUMES the
 *   socket-registry reusable workflows. So a tool bump can't be validated on
 *   the CI side until the registry's shared workflow has repinned + landed.
 *   socket-registry is the workspace + CI authority; the bump flows wheelhouse
 *   → socket-registry → fleet:
 *
 *   1. Bump the tool in the wheelhouse: external-tools.json (+ catalog if the tool
 *      is also a catalog dep, e.g. pnpm `packageManager`). Reconcile the
 *      wheelhouse lockfile.
 *   2. Run socket-registry's intra-registry layered bump
 *      (`scripts/cascade-workflows.mts`) — bump-until-stable across the action
 *      pins (Layer 1 → setup → setup-and-install → reusable workflows), one
 *      commit per stabilization pass. Push registry `main`.
 *   3. GATE 🛑 — the propagation SHA's OWN CI must be COMPLETED + SUCCESS before
 *      anything consumes it. A merged-but-red propagation SHA blasted to every
 *      consumer breaks the whole fleet at once (a one-line action edit can
 *      still pull a newly-malware-flagged transitive dep through the install
 *      step). Enforced here in code: red / in-progress → throw, never
 *      propagate.
 *   4. Layer 4: the registry's `_local-not-for-reuse-*` pins (folded into the
 *      bump-until-stable convergence) point at the propagation SHA.
 *   5. Re-pin the wheelhouse template's `uses:` SHAs
 *      (`scripts/fleet/sync-registry-workflow-pins.mts --fix`).
 *   6. Cascade the repinned template fleet-wide (`cascade-template.mts`) +
 *      reconcile lockfiles. DEFAULT = REPORT (read-only). The default run
 *      COPIES NOTHING and WRITES NOTHING — it inspects current-vs-latest tool
 *      versions, runs the registry bump in `--dry-run` (which lists stale pins
 *      without committing), checks for conflicts (dirty trees, soak window,
 *      missing registry checkout), and prints the plan + the
 *      propagation-SHA-to-be. Pass `--execute` to actually bump, push, gate,
 *      and propagate. A report run never dirties any working tree. Usage: node
 *      .../cascade-tool-pins.mts # report what WOULD happen (read-only) node
 *      .../cascade-tool-pins.mts --execute # run the full chain (pushes) node
 *      .../cascade-tool-pins.mts --tool pnpm # scope the report/run to one
 *      tool
 */

// prefer-async-spawn: sync-required — top-level orchestrator CLI; sequential
// cross-repo git/gh/node subprocesses with exit-code aggregation + a hard gate.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const REGISTRY_SLUG = 'SocketDev/socket-registry'
const REUSABLE_WORKFLOWS = ['ci', 'provenance', 'weekly-update'] as const

const ARGV = process.argv.slice(2)
const EXECUTE = ARGV.includes('--execute')

function resolveOnlyTool(): string | undefined {
  const i = ARGV.indexOf('--tool')
  return i !== -1 && ARGV[i + 1] ? ARGV[i + 1]!.trim() : undefined
}
const ONLY_TOOL = resolveOnlyTool()

// Same toolchain-resolution discipline as cascade-template / reconcile-lockfiles:
// prepend the RUNNING node's bin dir so spawned `pnpm`/`node` match the launcher
// (NVM_BIN can point at a different Node whose corepack pnpm is the wrong pin).
const NODE_BIN_DIR = path.dirname(process.execPath)
process.env['PATH'] = `${NODE_BIN_DIR}:${process.env['PATH'] || ''}`

// This script lives at <root>/.claude/skills/fleet/cascading-fleet/lib/ in a
// cascaded repo, OR <root>/template/.claude/... in the wheelhouse. Walk up to
// the nearest dir that has both .git and external-tools.json (the wheelhouse).
function resolveRepoRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(path.join(dir, 'external-tools.json')) &&
      existsSync(path.join(dir, '.git'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return process.cwd()
}
const REPO_ROOT = resolveRepoRoot()

const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

type RunResult = { status: number; stdout: string; stderr: string }

// git context vars a parent git invocation exports — strip them for any command
// run against a DIFFERENT repo via `-C`, or it operates on the ambient repo's
// git dir. (Same guard as sync-registry-workflow-pins.gitEnvForOtherRepo.)
const GIT_CONTEXT_VARS = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
]

function otherRepoEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (let i = 0, { length } = GIT_CONTEXT_VARS; i < length; i += 1) {
    delete env[GIT_CONTEXT_VARS[i]!]
  }
  return env
}

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined },
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts?.cwd ?? REPO_ROOT,
    env: opts?.env ?? process.env,
    encoding: 'utf8',
  })
  return {
    status: r.status ?? 1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  }
}

function gitClean(dir: string): boolean {
  const r = run('git', ['status', '--porcelain'], {
    cwd: dir,
    env: otherRepoEnv(),
  })
  return r.status === 0 && r.stdout.trim().length === 0
}

function findRegistryCheckout(): string | undefined {
  // socket-lint: allow cross-repo -- locating the sibling workspace authority is the orchestrator's job.
  const sibling = path.join(PROJECTS, 'socket-registry')
  return existsSync(path.join(sibling, '.github', 'workflows'))
    ? sibling
    : undefined
}

// Read the version each tool is currently pinned at in external-tools.json. Pure.
function readToolVersions(): Map<string, string> {
  const out = new Map<string, string>()
  const file = path.join(REPO_ROOT, 'external-tools.json')
  if (!existsSync(file)) {
    return out
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return out
  }
  const tools =
    parsed && typeof parsed === 'object' && 'tools' in parsed
      ? (parsed as { tools: Record<string, unknown> }).tools
      : undefined
  if (!tools || typeof tools !== 'object') {
    return out
  }
  for (const [name, entry] of Object.entries(tools)) {
    const version =
      entry && typeof entry === 'object' && 'version' in entry
        ? String((entry as { version: unknown }).version)
        : '?'
    if (!ONLY_TOOL || ONLY_TOOL === name) {
      out.set(name, version)
    }
  }
  return out
}

// The propagation SHA: socket-registry's reusable-workflow SHA as declared by
// its own `_local-not-for-reuse-<w>.yml` callers on origin/main (the
// reachable-by-construction live pin). Read-only: refreshes the remote ref then
// reads the file AT origin/main, never the working tree.
function readPropagationSha(registryCheckout: string): string | undefined {
  run('git', ['fetch', 'origin', 'main', '--quiet'], {
    cwd: registryCheckout,
    env: otherRepoEnv(),
  })
  for (let i = 0, { length } = REUSABLE_WORKFLOWS; i < length; i += 1) {
    const w = REUSABLE_WORKFLOWS[i]!
    const rel = `.github/workflows/_local-not-for-reuse-${w}.yml`
    const show = run('git', ['show', `origin/main:${rel}`], {
      cwd: registryCheckout,
      env: otherRepoEnv(),
    })
    if (show.status !== 0) {
      continue
    }
    const m = new RegExp(
      `socket-registry/\\.github/workflows/${w}\\.yml@([0-9a-f]{40})`,
    ).exec(show.stdout)
    if (m) {
      return m[1]
    }
  }
  return undefined
}

// The hard CI-green gate. Returns the conclusion string; only 'success' may
// propagate. Read-only (queries `gh run list`).
function ciConclusionForSha(sha: string): string {
  const r = run('gh', [
    'run',
    'list',
    '--repo',
    REGISTRY_SLUG,
    '--commit',
    sha,
    '--json',
    'workflowName,status,conclusion',
  ])
  if (r.status !== 0) {
    return `unknown (gh: ${r.stderr.trim().slice(0, 120)})`
  }
  let runs: Array<{
    workflowName?: string
    status?: string
    conclusion?: string
  }>
  try {
    runs = JSON.parse(r.stdout || '[]')
  } catch {
    return 'unknown (unparseable gh output)'
  }
  // Prefer the CI workflow; fall back to the first run.
  const ci = runs.find(x => (x.workflowName ?? '').includes('CI'))
  const pick = ci ?? runs[0]
  if (!pick) {
    return 'no-run-yet'
  }
  if (pick.status !== 'completed') {
    return `in-progress (${pick.status})`
  }
  return pick.conclusion ?? 'unknown'
}

function reportLine(label: string, value: string): void {
  logger.log(`  ${label.padEnd(26)} ${value}`)
}

// ── REPORT (default, read-only) ─────────────────────────────────────────────

function report(): void {
  logger.log(
    'Tool-pin cascade — REPORT (read-only; nothing copied or written).',
  )
  logger.log('')

  logger.log('Tools (external-tools.json):')
  const versions = readToolVersions()
  if (versions.size === 0) {
    reportLine('(none found)', ONLY_TOOL ? `for --tool ${ONLY_TOOL}` : '')
  }
  for (const [name, version] of versions) {
    reportLine(name, version)
  }
  logger.log('')
  logger.log(
    'Soak-cleared upgrade candidates (read-only — update-external-tools.mts is dry-run by default):',
  )
  // No flag = dry-run (prints planned changes, writes nothing). --apply flushes.
  const probe = run('node', [
    path.join(REPO_ROOT, 'scripts/repo/update-external-tools.mts'),
  ])
  const probeOut = (probe.stdout + probe.stderr).trim()
  logger.log(
    probeOut
      ? probeOut
          .split('\n')
          .map(l => `  ${l}`)
          .join('\n')
      : '  (none)',
  )
  logger.log('')

  logger.log('Preflight (conflicts that would block --execute):')
  reportLine(
    'wheelhouse tree',
    gitClean(REPO_ROOT) ? 'clean' : 'DIRTY (commit first)',
  )
  const registry = findRegistryCheckout()
  if (!registry) {
    reportLine(
      'socket-registry checkout',
      `MISSING (expected ${path.join(PROJECTS, 'socket-registry')})`,
    )
  } else {
    reportLine(
      'socket-registry tree',
      gitClean(registry) ? 'clean' : 'DIRTY (commit first)',
    )
  }
  logger.log('')

  if (registry) {
    logger.log(
      'socket-registry layered pins (cascade-workflows.mts --dry-run):',
    )
    const dry = run(
      'node',
      [path.join(registry, 'scripts/cascade-workflows.mts'), '--dry-run'],
      { cwd: registry, env: otherRepoEnv() },
    )
    const dryOut = (dry.stdout + dry.stderr).trim()
    logger.log(
      dryOut
        ? dryOut
            .split('\n')
            .map(l => `  ${l}`)
            .join('\n')
        : '  (no stale pins)',
    )
    logger.log('')

    const prop = readPropagationSha(registry)
    if (prop) {
      reportLine('current propagation SHA', prop.slice(0, 12))
      reportLine('  its CI conclusion', ciConclusionForSha(prop))
    } else {
      reportLine(
        'current propagation SHA',
        'could not resolve (no _local pin on origin/main)',
      )
    }
  }
  logger.log('')
  logger.log('To run the cascade: re-invoke with --execute (pushes to')
  logger.log(
    'socket-registry main + propagates fleet-wide after the CI-green gate).',
  )
}

// ── EXECUTE (--execute, writes + pushes) ────────────────────────────────────

function execute(): void {
  logger.log('Tool-pin cascade — EXECUTE.')
  if (!gitClean(REPO_ROOT)) {
    throw new Error(
      'wheelhouse working tree is dirty — commit or stash your changes before ' +
        '`--execute` (a tool-pin cascade pushes; it must start from a clean tree)',
    )
  }
  const registry = findRegistryCheckout()
  if (!registry) {
    throw new Error(
      `socket-registry checkout not found at ${path.join(PROJECTS, 'socket-registry')} ` +
        '— the registry is the workspace + CI authority a tool-pin cascade flows ' +
        'through. Clone it as a sibling, then retry.',
    )
  }
  if (!gitClean(registry)) {
    throw new Error(
      `socket-registry working tree is dirty (${registry}) — commit or stash there ` +
        'first; the layered bump commits one pass at a time and a dirty tree would ' +
        'ride along.',
    )
  }

  logger.log('[1/6] bumping external-tools.json to soak-cleared latest…')
  // --apply flushes the bump (default is dry-run).
  const bump = run('node', [
    path.join(REPO_ROOT, 'scripts/repo/update-external-tools.mts'),
    '--apply',
  ])
  logger.log(bump.stdout.trimEnd())
  if (bump.status !== 0) {
    throw new Error(
      `update-external-tools.mts failed:\n${bump.stderr.slice(-1500)}`,
    )
  }

  logger.log(
    '[2/6] running socket-registry layered bump (cascade-workflows.mts)…',
  )
  const cascade = run(
    'node',
    [path.join(registry, 'scripts/cascade-workflows.mts')],
    { cwd: registry, env: otherRepoEnv() },
  )
  logger.log(cascade.stdout.trimEnd())
  if (cascade.status !== 0) {
    throw new Error(
      `cascade-workflows.mts failed:\n${cascade.stderr.slice(-1500)}`,
    )
  }
  const push = run('git', ['push', 'origin', 'main'], {
    cwd: registry,
    env: otherRepoEnv(),
  })
  if (push.status !== 0) {
    throw new Error(
      'pushing socket-registry main failed (branch protection? resolve + push ' +
        `manually):\n${push.stderr.slice(-1000)}`,
    )
  }

  const prop = readPropagationSha(registry)
  if (!prop) {
    throw new Error(
      'could not resolve the propagation SHA from socket-registry _local pins on ' +
        'origin/main — aborting before any fleet propagation.',
    )
  }
  logger.log(`[3/6] CI-green gate on propagation SHA ${prop.slice(0, 12)}…`)
  const conclusion = ciConclusionForSha(prop)
  if (conclusion !== 'success') {
    throw new Error(
      `propagation SHA ${prop.slice(0, 12)} CI is "${conclusion}", not "success". ` +
        'A merged-but-red SHA blasted fleet-wide breaks every consumer at once. Fix ' +
        'the failure at the source layer, land a new Layer 3 commit, and re-run. ' +
        'There is no bypass for a red propagation SHA.',
    )
  }
  logger.log('  CI is green')

  // Layer 4 (_local pins) is folded into cascade-workflows' bump-until-stable
  // convergence — it repins _local to the new reusable-workflow SHAs in the
  // same loop, so by here _local already points at the propagation SHA.

  logger.log(
    '[5/6] repinning template workflow SHAs (sync-registry-workflow-pins.mts --fix)…',
  )
  const repin = run('node', [
    path.join(REPO_ROOT, 'scripts/fleet/sync-registry-workflow-pins.mts'),
    '--fix',
  ])
  logger.log(repin.stdout.trimEnd())
  // --fix exits 0 (clean/fixed) or 1 (drift found+fixed); a higher code is real.
  if (repin.status !== 0 && repin.status !== 1) {
    throw new Error(
      `sync-registry-workflow-pins.mts failed:\n${repin.stderr.slice(-1500)}`,
    )
  }

  logger.log('')
  logger.log(
    `[6/6] template repinned to ${prop.slice(0, 12)}. NEXT (manual, highest blast radius):`,
  )
  logger.log(
    '  - Commit the template workflow-pin + external-tools.json changes here.',
  )
  logger.log(
    '  - Cascade fleet-wide: node .claude/skills/fleet/cascading-fleet/lib/cascade-template.mts <sha>',
  )
  logger.log(
    '  - Reconcile lockfiles: Workflow({ name: "reconcile-fleet-lockfiles" })',
  )
  logger.log('')
  logger.log(
    'Stopped before the fleet-wide push — review the template diff, then cascade.',
  )
}

function main(): void {
  if (ARGV.includes('--help') || ARGV.includes('-h')) {
    logger.log(
      'Usage: node cascade-tool-pins.mts [--execute] [--tool <name>]\n' +
        '  (default: read-only report — copies nothing, writes nothing)',
    )
    return
  }
  if (EXECUTE) {
    execute()
  } else {
    report()
  }
}

if (process.argv[1]?.endsWith('cascade-tool-pins.mts')) {
  try {
    main()
  } catch (e) {
    logger.fail(
      `cascade-tool-pins: ${e instanceof Error ? e.message : String(e)}`,
    )
    process.exitCode = 1
  }
}
