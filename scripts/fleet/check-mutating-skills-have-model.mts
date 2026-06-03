#!/usr/bin/env node
/**
 * @file Cost-routing gate: every fleet SKILL.md that can MUTATE the tree must
 *   declare a `model:` in its frontmatter, so the fleet routes mechanical fix
 *   work to a cheap tier (haiku) and reserves the expensive tiers (sonnet/opus)
 *   for skills that genuinely reason. Without a declared model a fix-skill runs
 *   on whatever the session model is — often Opus — paying premium tokens for
 *   mechanical work. A skill "mutates" when its `allowed-tools` includes an
 *   editing tool (Edit / Write / NotebookEdit) or a state-changing git command
 *   (git commit / git add). Read-only skills (report / audit / scan) are exempt
 *   — they don't apply changes, so their model is the caller's choice.
 *
 *   Tier reference: docs/claude.md/fleet/skill-model-routing.md (haiku =
 *   mechanical, sonnet = judgment, opus = heavy reasoning). EFFORT stays a doc
 *   convention there, not a per-skill field (the harness reads $CLAUDE_EFFORT,
 *   not skill frontmatter).
 *
 *   Scope: `.claude/skills/fleet/<name>/SKILL.md`. Exit codes: 0 — every
 *   mutating skill declares model:; 1 — at least one mutating skill is missing it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..', '..')
const skillsDir = path.join(rootPath, '.claude', 'skills', 'fleet')

// Tools whose presence in allowed-tools means the skill changes the tree.
const MUTATING_TOOL_RE = /\b(?:Edit|NotebookEdit|Write|git add|git commit)\b/

// Extract the YAML frontmatter block (between the first two `---` lines).
export function frontmatter(text: string): string | undefined {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') {
    return undefined
  }
  for (let i = 1, { length } = lines; i < length; i += 1) {
    if (lines[i]?.trim() === '---') {
      return lines.slice(1, i).join('\n')
    }
  }
  return undefined
}

export function isMutating(fm: string): boolean {
  const m = fm.match(/^allowed-tools:\s*(.+)$/m)
  return !!m && MUTATING_TOOL_RE.test(m[1]!)
}

export function hasModel(fm: string): boolean {
  return /^model:\s*\S/m.test(fm)
}

async function main(): Promise<void> {
  if (!existsSync(skillsDir)) {
    logger.success('No fleet skills to check.')
    return
  }
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter(d =>
    d.isDirectory(),
  )
  const offenders: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!.name
    const skillPath = path.join(skillsDir, name, 'SKILL.md')
    if (!existsSync(skillPath)) {
      continue
    }
    const fm = frontmatter(readFileSync(skillPath, 'utf8'))
    if (!fm) {
      continue
    }
    if (isMutating(fm) && !hasModel(fm)) {
      offenders.push(name)
    }
  }

  if (offenders.length) {
    logger.error(
      `Mutating fleet skills missing a model: frontmatter (${offenders.length}):`,
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ${offenders[i]!}`)
    }
    logger.error(
      'A skill that edits the tree must declare model: so fix work routes to the cheap tier. See docs/claude.md/fleet/skill-model-routing.md (haiku=mechanical, sonnet=judgment, opus=heavy). Add `model: claude-haiku-4-5` + `context: fork` (or the right tier).',
    )
    process.exitCode = 1
    return
  }

  logger.success('Every mutating fleet skill declares a model: tier.')
}

main().catch((e: unknown) => {
  logger.error(`check-mutating-skills-have-model failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
