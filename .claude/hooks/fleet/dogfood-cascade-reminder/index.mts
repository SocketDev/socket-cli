#!/usr/bin/env node
// Claude Code Stop hook — dogfood-cascade-reminder.
//
// Fires at turn-end in socket-wheelhouse. The wheelhouse dogfoods its own
// template: the root `.claude/`, `.config/fleet/`, `scripts/fleet/`, and
// CLAUDE.md fleet block are git-tracked COPIES that the running session
// actually uses. The fleet rule (CLAUDE.md "Cascade work"):
//
//   Every `template/` edit triggers a same-turn dogfood cascade
//   (`node scripts/repo/sync-scaffolding/cli.mts --target . --fix`) — an
//   un-cascaded `template/` edit leaves the LIVE copy stale.
//
// This hook enforces it on real filesystem state, not turn narration: it
// lists the `template/<X>` files this session changed (vs origin/main + the
// working tree), compares each to its dogfood twin `./<X>`, and if any differ
// it reminds you to cascade. CLAUDE.md is compared by its fleet block only
// (BEGIN/END FLEET-CANONICAL) — the preamble + project-specific postamble are
// repo-owned and intentionally NOT mirrored.
//
// Only runs when a `template/` directory exists at the project root (i.e. we
// are IN the wheelhouse). In a cascaded fleet repo there is no template/, so
// the hook is a no-op.
//
// Exit codes:
//   0 — always. Informational; never blocks (Stop hooks fire after the turn).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

export async function drainStdin(): Promise<void> {
  await new Promise<void>(resolve => {
    process.stdin.on('data', () => {})
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    setTimeout(() => resolve(), 200)
  })
}

export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

const FLEET_BEGIN = '<!-- BEGIN FLEET-CANONICAL'
const FLEET_END = '<!-- END FLEET-CANONICAL'

// Extract the fleet block (BEGIN…END inclusive) from a CLAUDE.md; undefined
// when the markers are absent.
export function fleetBlock(content: string): string | undefined {
  const b = content.indexOf(FLEET_BEGIN)
  const e = content.indexOf(FLEET_END)
  if (b === -1 || e === -1 || e < b) {
    return undefined
  }
  return content.slice(b, e)
}

// List template/* files this session touched: committed-vs-origin + dirty
// working tree. Cheap — two `git` calls, name-only.
export function changedTemplateFiles(repoDir: string): string[] {
  const out = new Set<string>()
  for (const args of [
    ['diff', '--name-only', 'origin/HEAD...HEAD'],
    ['diff', '--name-only', 'origin/main...HEAD'],
    ['status', '--porcelain'],
  ]) {
    const r = spawnSync('git', args, { cwd: repoDir, timeout: 5_000 })
    if (r.status !== 0) {
      continue
    }
    for (const raw of String(r.stdout).split('\n')) {
      const line = raw.trim()
      if (!line) {
        continue
      }
      // `git status --porcelain` lines carry a 2-char status prefix.
      const file = args[0] === 'status' ? line.slice(3).trim() : line
      if (file.startsWith('template/')) {
        out.add(file)
      }
    }
  }
  return [...out]
}

// Files the dogfood copy MERGES rather than copies verbatim — comparing them
// byte-for-byte false-fires. settings.json is merge(template fleet hooks ∪
// repo-tier hook declarations), so the dogfood has extra `.claude/hooks/repo/*`
// entries the template never will. Its sync is validated by the cascade's own
// settings_merge_drift check, not by this hook. (CLAUDE.md is handled below by
// fleet-block-only comparison.)
const MERGE_TARGET_BASENAMES = new Set(['settings.json'])

// A changed template file is "uncascaded" when its dogfood twin differs.
// CLAUDE.md compares by fleet block only; merge-target files are skipped;
// everything else is byte-compare.
export function isUncascaded(repoDir: string, templateRel: string): boolean {
  const base = path.basename(templateRel)
  if (MERGE_TARGET_BASENAMES.has(base)) {
    return false
  }
  const twinRel = templateRel.slice('template/'.length)
  const templateAbs = path.join(repoDir, templateRel)
  const twinAbs = path.join(repoDir, twinRel)
  if (!existsSync(templateAbs) || !existsSync(twinAbs)) {
    // A new template file with no twin yet IS uncascaded.
    return existsSync(templateAbs) && !existsSync(twinAbs)
  }
  let tpl: string
  let twin: string
  try {
    tpl = readFileSync(templateAbs, 'utf8')
    twin = readFileSync(twinAbs, 'utf8')
  } catch {
    return false
  }
  if (base === 'CLAUDE.md') {
    const a = fleetBlock(tpl)
    const b = fleetBlock(twin)
    if (a === undefined || b === undefined) {
      return false
    }
    return a !== b
  }
  return tpl !== twin
}

async function main(): Promise<void> {
  await drainStdin()
  const repoDir = getProjectDir()
  // Only the wheelhouse has a template/ tree to cascade FROM.
  if (!existsSync(path.join(repoDir, 'template'))) {
    process.exit(0)
  }
  const changed = changedTemplateFiles(repoDir)
  if (changed.length === 0) {
    process.exit(0)
  }
  const stale = changed.filter(f => isUncascaded(repoDir, f))
  if (stale.length === 0) {
    process.exit(0)
  }
  const lines = [
    '[dogfood-cascade-reminder] Edited template/ but the dogfood copy is stale:',
    '',
    ...stale.slice(0, 12).map(f => `  • ${f} ↔ ./${f.slice('template/'.length)}`),
    stale.length > 12 ? `  • …and ${stale.length - 12} more` : '',
    '',
    '  The wheelhouse runs its OWN .claude/ / .config/ / scripts/fleet/ — those',
    '  are copies of template/, so an un-cascaded edit leaves the live repo',
    '  stale. Run the same-turn dogfood cascade:',
    '',
    '    node scripts/repo/sync-scaffolding/cli.mts --target . --fix',
    '',
    '  Then commit the template source (the cascade commits the dogfood copy).',
    '',
  ].filter(line => line !== '')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
