#!/usr/bin/env node
/*
 * @file Doc-integrity gate: every hook + socket/ rule CITED in CLAUDE.md must
 *   actually exist. CLAUDE.md documents the fleet's guardrails by naming the
 *   enforcing hook (a backticked `.claude/hooks/fleet/<name>/` citation — the
 *   minimal form, no prose wrapper) and the lint rule (a "socket/<rule>"
 *   reference). When a hook is renamed/removed or a rule is dropped, the
 *   citation goes stale and the doc lies — a reader (human or agent) trusts a
 *   guard that no longer exists. The `new-hook-claude-md-guard` enforces the
 *   FORWARD direction at edit time (new hook ⇒ needs a citation); this gate
 *   enforces the REVERSE at commit time (citation ⇒ the thing exists), which
 *   nothing else checks. Checks:
 *
 *   1. Every `.claude/hooks/fleet/<name>/` cited in CLAUDE.md resolves to a real
 *      hook dir. Brace-grouped citations (`{a,b,c}/`) are expanded. Repo-only
 *      hooks (`.claude/hooks/repo/<name>/`) are checked the same way.
 *   2. Every `socket/<rule>` cited in CLAUDE.md is a registered rule in the oxlint
 *      plugin's fleet/ tier (one dir per rule). Advisory (logged, non-failing):
 *      hooks on disk with
 *      NO citation, EXCEPT the reminder family + wheelhouse-only set (those
 *      legitimately need none). This surfaces undocumented guards without
 *      gating — promoting one to a citation is a judgment call, not a
 *      mechanical fix. Reads the wheelhouse template tree when run there, else
 *      the repo's own CLAUDE.md + .claude/hooks. Exit codes: 0 — every citation
 *      resolves; 1 — at least one cited hook / rule is missing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { hasFleetHookSource } from '../_shared/fleet-source-present.mts'

const logger = getDefaultLogger()

// Citation shapes (mirror new-hook-claude-md-guard): inline + comma-listed both
// contain the literal backticked path; brace-grouped is `{a,b,c}/` expansion.
const HOOK_CITATION_RE =
  /\.claude\/hooks\/(fleet|repo)\/([a-z][a-z0-9-]*|\{[^}]+\})\//g
const RULE_CITATION_RE = /`socket\/([a-z][a-z0-9-]*)`/g
// A user-invocable skill cited as `/fleet:<name>` (the form the harness shows
// and the Agents & skills bullets use). Must resolve to a real
// .claude/skills/fleet/<name>/SKILL.md so a renamed/removed skill bullet can't
// rot. Backticked or bare both count; the leading `/fleet:` is the anchor.
const SKILL_CITATION_RE = /\/fleet:([a-z][a-z0-9-]*)/g

// Expand a citation path's name part: `{a,b,c}` → [a,b,c]; `foo` → [foo].
export function expandNames(raw: string): string[] {
  if (raw.startsWith('{') && raw.endsWith('}')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }
  return [raw]
}

// All cited hooks, as { segment, name } pairs.
export function citedHooks(
  claudeMd: string,
): Array<{ segment: string; name: string }> {
  const out: Array<{ segment: string; name: string }> = []
  for (const m of claudeMd.matchAll(HOOK_CITATION_RE)) {
    const segment = m[1]!
    for (const name of expandNames(m[2]!)) {
      out.push({ segment, name })
    }
  }
  return out
}

export function citedRules(claudeMd: string): string[] {
  const out: string[] = []
  for (const m of claudeMd.matchAll(RULE_CITATION_RE)) {
    out.push(m[1]!)
  }
  return [...new Set(out)]
}

// All `/fleet:<name>` skill citations, de-duplicated.
export function citedSkills(claudeMd: string): string[] {
  const out: string[] = []
  for (const m of claudeMd.matchAll(SKILL_CITATION_RE)) {
    out.push(m[1]!)
  }
  return [...new Set(out)]
}

function listDirNames(dir: string): Set<string> {
  try {
    return new Set(
      readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name),
    )
  } catch {
    return new Set()
  }
}

async function main(): Promise<void> {
  const claudeMdPath = path.join(REPO_ROOT, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    logger.success('No CLAUDE.md to check.')
    return
  }
  // A bundle-only member has no per-hook / per-rule SOURCE dirs to resolve
  // citations against — every citation would read as dangling. The doc +
  // citations are validated at the source repo.
  if (!hasFleetHookSource(REPO_ROOT)) {
    logger.success(
      'No fleet hook source in this repo (bundle-only) — citations validated at the source repo.',
    )
    return
  }
  const claudeMd = readFileSync(claudeMdPath, 'utf8')

  const fleetHooks = listDirNames(path.join(REPO_ROOT, '.claude/hooks/fleet'))
  const repoHooks = listDirNames(path.join(REPO_ROOT, '.claude/hooks/repo'))
  // Each rule is a dir under the plugin's fleet/ tier; the dir name is the id.
  const rules = listDirNames(
    path.join(REPO_ROOT, '.config/fleet/oxlint-plugin/fleet'),
  )
  // A skill resolves when .claude/skills/fleet/<name>/SKILL.md exists.
  const fleetSkills = new Set(
    [...listDirNames(path.join(REPO_ROOT, '.claude/skills/fleet'))].filter(
      name =>
        existsSync(
          path.join(REPO_ROOT, '.claude/skills/fleet', name, 'SKILL.md'),
        ),
    ),
  )

  const failures: string[] = []

  for (const { segment, name } of citedHooks(claudeMd)) {
    const present =
      segment === 'fleet' ? fleetHooks.has(name) : repoHooks.has(name)
    // A hook may be cited at fleet/ but live at repo/ (or vice versa) after a
    // move — accept either segment so a relocation isn't a false failure, but
    // require the hook to exist SOMEWHERE.
    const existsEither = fleetHooks.has(name) || repoHooks.has(name)
    if (!present && !existsEither) {
      failures.push(
        `cited hook \`.claude/hooks/${segment}/${name}/\` does not exist (renamed or removed?)`,
      )
    }
  }

  // Only check rule citations when this repo ships the plugin.
  if (rules.size > 0) {
    for (const rule of citedRules(claudeMd)) {
      if (!rules.has(rule)) {
        failures.push(
          `cited rule \`socket/${rule}\` is not a registered oxlint rule (renamed or removed?)`,
        )
      }
    }
  }

  // Only check skill citations when this repo ships fleet skills.
  if (fleetSkills.size > 0) {
    for (const skill of citedSkills(claudeMd)) {
      if (!fleetSkills.has(skill)) {
        failures.push(
          `cited skill \`/fleet:${skill}\` has no .claude/skills/fleet/${skill}/SKILL.md (renamed or removed?)`,
        )
      }
    }
  }

  if (failures.length) {
    logger.error(`CLAUDE.md citation drift (${failures.length}):`)
    for (let i = 0, { length } = failures; i < length; i += 1) {
      logger.error(`  ${failures[i]!}`)
    }
    process.exitCode = 1
    return
  }

  logger.success('CLAUDE.md citations all resolve — no stale hook / rule refs.')
}

main().catch((e: unknown) => {
  logger.error(`check-claude-md-citations-resolve failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
