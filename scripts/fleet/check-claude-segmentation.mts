/**
 * @file Enforce `.claude/{agents,commands,hooks,skills}/` segmentation. Every
 *   entry in those four directories must live under `fleet/<name>/` (when the
 *   wheelhouse template ships an entry with that name) or `repo/<name>/`
 *   (everything else). Dangling top-level entries
 *   (`.claude/skills/<name>/SKILL.md` instead of
 *   `.claude/skills/fleet/<name>/SKILL.md`) are pre-segmentation leftovers and
 *   should be removed or rehomed. Why this matters: the wheelhouse cascade
 *   synth + hooks all key on the `fleet/`-prefixed shape. Dangling top-level
 *   entries duplicate or shadow the canonical copy, breaking
 *   skill/command/agent/hook resolution in unpredictable ways. Past incident:
 *   2026-06-01 fleet-wide audit found ~200 dangling entries across 10 repos —
 *   every fleet repo had at least 18 duplicate top-level skill directories
 *   shadowing their `fleet/<name>/` counterparts. Exceptions: `_shared/` (and
 *   any other `_`-prefixed name) is allowed at the top level — it's the
 *   documented internals folder. Behavior:
 *
 *   - Read mode (default): exit 1 with a per-entry report when dangling entries
 *     exist. Exit 0 when clean.
 *   - `--fix`: move each dangling entry into `fleet/` (if its name is in the
 *     wheelhouse-canonical set) or `repo/`. Removes duplicates that already
 *     have a `fleet/<name>/` counterpart. The wheelhouse template's fleet set
 *     is read from `<wheelhouse>/template/.claude/<kind>/fleet/` at runtime
 *     when invoked from a fleet repo. In a fleet repo without a sibling
 *     wheelhouse checkout, the script falls back to a built-in list (kept in
 *     lockstep with the template via the wheelhouse cascade itself).
 */

import { existsSync, promises as fs, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')

interface KindSpec {
  // Directory name under `.claude/`.
  dir: 'agents' | 'commands' | 'hooks' | 'skills'
  // Are entries directories (true) or `.md` files (false)?
  entryIsDir: boolean
}

const KINDS: readonly KindSpec[] = [
  { dir: 'agents', entryIsDir: false },
  { dir: 'commands', entryIsDir: false },
  { dir: 'hooks', entryIsDir: true },
  { dir: 'skills', entryIsDir: true },
] as const

interface DanglingEntry {
  kind: KindSpec['dir']
  name: string
  // Absolute path of the dangling entry (dir or file).
  src: string
  // Resolution: 'dup-of-fleet' | 'rehome-to-fleet' | 'move-to-repo'.
  action: 'dup-of-fleet' | 'rehome-to-fleet' | 'move-to-repo'
  // Absolute destination (when action is rehome / move).
  dest?: string | undefined
}

/**
 * Read the wheelhouse template's `fleet/<kind>/` set. Looks for a sibling
 * `socket-wheelhouse/template/.claude/<kind>/fleet/` checkout first; falls back
 * to the BUILTIN_FLEET_SET below if the wheelhouse isn't reachable (e.g. in CI
 * where the fleet repo is checked out alone).
 */
export function getFleetSet(kind: string): Set<string> {
  const candidates = [
    path.join(
      REPO_ROOT,
      '..',
      'socket-wheelhouse',
      'template',
      '.claude',
      kind,
      'fleet',
    ),
    path.join(
      REPO_ROOT,
      '..',
      '..',
      'socket-wheelhouse',
      'template',
      '.claude',
      kind,
      'fleet',
    ),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const dir = candidates[i]!
    if (existsSync(dir)) {
      const entries = readdirSync(dir).filter(n => !n.startsWith('_'))
      return new Set(entries.map(n => n.replace(/\.md$/, '')))
    }
  }
  return new Set(BUILTIN_FLEET_SET[kind] ?? [])
}

/**
 * Built-in canonical set per kind. Kept in lockstep with the wheelhouse
 * template via the cascade itself — when a new fleet skill/command/agent/hook
 * lands in `socket-wheelhouse/template/.claude/<kind>/fleet/`, the cascade
 * re-syncs this file too. If you're editing this list by hand, you're probably
 * in the wrong place; add to the wheelhouse template instead.
 *
 * Snapshot at 2026-06-01.
 */
export const BUILTIN_FLEET_SET: Readonly<Record<string, readonly string[]>> = {
  agents: ['security-reviewer'],
  commands: [
    'audit-gha-settings',
    'green-ci',
    'quality-loop',
    'security-scan',
    'setup-security-tools',
    'squash-history',
    'update-coverage',
    'update-security',
  ],
  hooks: [],
  skills: [
    'agent-ci',
    'auditing-gha-settings',
    'cascading-fleet',
    'cleaning-redundant-ci',
    'driving-cursor-bugbot',
    'greening-ci',
    'guarding-paths',
    'handing-off',
    'locking-down-programmatic-claude',
    'plug-leaking-promise-race',
    'prose',
    'refreshing-history',
    'regenerating-plugin-patches',
    'reviewing-code',
    'rule-pack-migrations',
    'running-test262',
    'scanning-quality',
    'scanning-security',
    'squashing-history',
    'trimming-bundle',
    'updating',
    'updating-coverage',
    'updating-daily',
    'updating-lockstep',
    'updating-security',
    'worktree-management',
  ],
}

/**
 * Find every dangling entry under `.claude/<kind>/<name>/` (or `<name>.md` for
 * file-shaped kinds). An entry is dangling when its parent is the top-level
 * kind directory rather than `fleet/` or `repo/`, and its name isn't a
 * `_`-prefixed internals folder.
 */
export function findDanglingEntries(repoRoot: string): DanglingEntry[] {
  const out: DanglingEntry[] = []
  for (const spec of KINDS) {
    const root = path.join(repoRoot, '.claude', spec.dir)
    if (!existsSync(root)) {
      continue
    }
    const fleetSet = getFleetSet(spec.dir)
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('_')) {
        continue
      }
      if (entry === 'fleet' || entry === 'repo') {
        continue
      }
      const src = path.join(root, entry)
      const isDir = statSync(src).isDirectory()
      if (spec.entryIsDir && !isDir) {
        continue
      }
      if (!spec.entryIsDir && (isDir || !entry.endsWith('.md'))) {
        continue
      }
      const name = spec.entryIsDir ? entry : entry.replace(/\.md$/, '')
      const inFleet = fleetSet.has(name)
      let action: DanglingEntry['action']
      let dest: string | undefined
      const fleetDest = path.join(root, 'fleet', entry)
      const repoDest = path.join(root, 'repo', entry)
      if (inFleet) {
        if (existsSync(fleetDest)) {
          action = 'dup-of-fleet'
        } else {
          action = 'rehome-to-fleet'
          dest = fleetDest
        }
      } else {
        action = 'move-to-repo'
        dest = repoDest
      }
      out.push({ kind: spec.dir, name, src, action, dest })
    }
  }
  return out
}

/**
 * Apply the fix for each dangling entry — `rm -rf` for `dup-of-fleet`, `mv` for
 * `rehome-to-fleet` / `move-to-repo`. Operates on the filesystem; commit + push
 * is the caller's job.
 */
async function applyFix(entries: readonly DanglingEntry[]): Promise<void> {
  for (const e of entries) {
    if (e.action === 'dup-of-fleet') {
      await safeDelete(e.src)
      logger.log(`  rm ${path.relative(REPO_ROOT, e.src)}`)
      continue
    }
    if (e.dest === undefined) {
      continue
    }
    await fs.mkdir(path.dirname(e.dest), { recursive: true })
    await fs.rename(e.src, e.dest)
    logger.log(
      `  mv ${path.relative(REPO_ROOT, e.src)} -> ${path.relative(REPO_ROOT, e.dest)}`,
    )
  }
}

function formatReport(entries: readonly DanglingEntry[]): string {
  if (entries.length === 0) {
    return ''
  }
  const lines: string[] = []
  lines.push('[check-claude-segmentation] Dangling entries detected:')
  lines.push('')
  const byKind = new Map<string, DanglingEntry[]>()
  for (const e of entries) {
    const arr = byKind.get(e.kind) ?? []
    arr.push(e)
    byKind.set(e.kind, arr)
  }
  for (const [kind, kindEntries] of byKind) {
    lines.push(`  .claude/${kind}/:`)
    for (const e of kindEntries) {
      const annotation =
        e.action === 'dup-of-fleet'
          ? '(duplicate of fleet/; rm)'
          : e.action === 'rehome-to-fleet'
            ? '-> fleet/'
            : '-> repo/'
      lines.push(`    ${e.name}  ${annotation}`)
    }
    lines.push('')
  }
  lines.push(
    '  Fix: run `node scripts/fleet/check-claude-segmentation.mts --fix`.',
  )
  lines.push('  Wheelhouse-canonical entries live under fleet/; repo-only')
  lines.push('  entries live under repo/. Top-level dangling entries shadow')
  lines.push('  the canonical copies and break skill resolution.')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const entries = findDanglingEntries(REPO_ROOT)
  if (entries.length === 0) {
    return
  }
  if (!fix) {
    logger.error(formatReport(entries))
    process.exitCode = 1
    return
  }
  logger.log(`[check-claude-segmentation] Applying ${entries.length} fix(es):`)
  await applyFix(entries)
  logger.log('[check-claude-segmentation] Done.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`[check-claude-segmentation] error: ${e}`)
    process.exitCode = 1
  })
}
