/**
 * @file Claude Code Stop hook — agents-skills-mirror-nudge. The cross-tool
 *   `.agents/skills/` mirror is a DERIVED artifact: the generator
 *   `scripts/fleet/gen-agents-skills-mirror.mts` hoists each segmented
 *   `.claude/skills/{fleet,repo}/<name>/` skill into a flat `.agents/skills/`
 *   view so Codex + OpenCode (which discover skills one level deep) find every
 *   fleet/repo skill. The `agents-skills-mirror-is-current` CI check reds when
 *   the committed mirror drifts from the source. A cascade regenerates the
 *   mirror in the same wave that copies a skill source (sync-scaffolding's
 *   fix-agents-mirror.mts), so the cascade path can't strand it. This hook is
 *   the backstop for the OTHER path: a hand-edited skill (especially a
 *   repo-tier `.claude/skills/repo/<name>/` skill, which has no template twin
 *   to trip dogfood-cascade-nudge). At turn-end, if this session touched any
 *   `.claude/skills/**` file AND the mirror now drifts, it nudges to regenerate
 *   — catching the stale mirror BEFORE it reaches CI.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineHook, notify, runHook } from '../_shared/guard.mts'

export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

// True when a repo-relative path names a `.claude/skills/` source file. Pure —
// the file-classification half of touchedSkillSource, unit-tested directly.
export function isSkillSourcePath(file: string): boolean {
  return file.startsWith('.claude/skills/')
}

// Extract changed repo-relative paths from one git command's name-only/porcelain
// output. `status --porcelain` lines carry a positional 2-char XY status prefix
// then a space (`slice(3)`) — they must NOT be left-trimmed first, since the
// leading space IS part of the status field. `diff --name-only` lines are bare
// paths, so trimming is safe there.
export function parseChangedPaths(
  subcommand: string,
  stdout: string,
): string[] {
  const out: string[] = []
  for (const raw of stdout.split('\n')) {
    if (!raw.trim()) {
      continue
    }
    const file = subcommand === 'status' ? raw.slice(3).trim() : raw.trim()
    if (file) {
      out.push(file)
    }
  }
  return out
}

// True when this session touched any `.claude/skills/**` file — committed vs
// origin plus the dirty working tree. Two name-only git calls; a `.git`-less
// dir reports nothing (every git call fails, so the scan finds no match).
export function touchedSkillSource(repoDir: string): boolean {
  for (const args of [
    ['diff', '--name-only', 'origin/HEAD…HEAD'],
    ['status', '--porcelain'],
  ]) {
    const r = spawnSync('git', args, { cwd: repoDir, timeout: 5000 })
    if (r.status !== 0) {
      continue
    }
    const changed = parseChangedPaths(args[0]!, String(r.stdout))
    for (let i = 0, { length } = changed; i < length; i += 1) {
      if (isSkillSourcePath(changed[i]!)) {
        return true
      }
    }
  }
  return false
}

// Run the generator's `--check` mode; exit 1 means the mirror is stale. Absent
// generator (a repo that doesn't ship the mirror) → not stale (no-op).
export function mirrorIsStale(repoDir: string): boolean {
  const gen = path.join(
    repoDir,
    'scripts',
    'fleet',
    'gen-agents-skills-mirror.mts',
  )
  if (!existsSync(gen)) {
    return false
  }
  const r = spawnSync(process.execPath, [gen, '--check'], {
    cwd: repoDir,
    timeout: 30_000,
  })
  return r.status === 1
}

export const hook = defineHook({
  check: () => {
    const repoDir = getProjectDir()
    if (!touchedSkillSource(repoDir)) {
      return undefined
    }
    if (!mirrorIsStale(repoDir)) {
      return undefined
    }
    return notify(
      [
        '[agents-skills-mirror-nudge] Edited a .claude/skills/ source but the',
        '  derived .agents/skills/ mirror is stale (Codex + OpenCode read the',
        '  mirror, not .claude/skills/). Regenerate it so CI stays green:',
        '',
        '    node scripts/fleet/gen-agents-skills-mirror.mts',
        '',
        '  Then commit the regenerated .agents/skills/ alongside the skill edit.',
        '',
      ].join('\n'),
    )
  },
  event: 'Stop',
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
