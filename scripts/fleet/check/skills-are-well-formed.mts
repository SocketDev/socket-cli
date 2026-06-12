// Fleet check — every skill directory is a well-formed skill.
//
// A `.claude/skills/fleet/<name>/` directory is the canonical home of a fleet
// skill. "Code is law": a skill is the DOCUMENTED layer of a discipline, so its
// SKILL.md must actually exist and carry the frontmatter the loader + the
// sibling gates rely on. This check is the structural floor:
//
//   1. The dir has a `SKILL.md`. (A dir with a `lib/` engine but no SKILL.md is
//      a half-built skill — it has no agent-facing contract, the
//      agents-skills-mirror generator can't mirror it, and a `/fleet:<name>`
//      citation to it can't resolve. This is exactly the gap that let
//      tidying-files ship an engine + test with no SKILL.md.)
//   2. The SKILL.md has frontmatter (a leading `---` … `---` block).
//   3. The frontmatter declares `name:` AND it MATCHES the directory name (the
//      loader + the mirror generator both key on name == dir).
//   4. The frontmatter declares a non-empty `description:` (the trigger text the
//      model uses to decide relevance — a skill with none is undiscoverable).
//
// Complements: mutating-skills-have-model (model: gate), claude-md-citations-
// resolve (every /fleet:<name> bullet resolves), agents-skills-mirror-is-current
// (the .agents mirror). Those assume a well-formed SKILL.md; this asserts it.
//
// `_shared` is not a skill (shared subskill libs) — skipped.
//
// ERROR (exit 1): any skill dir missing SKILL.md, frontmatter, a matching name,
// or a description.
//
// Usage: node scripts/fleet/check/skills-are-well-formed.mts [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface SkillDefect {
  name: string
  reason:
    | 'no-skill-md'
    | 'no-frontmatter'
    | 'no-name'
    | 'name-mismatch'
    | 'no-description'
  detail: string
}

/**
 * Extract the leading `---` … `---` frontmatter block of a markdown file, or
 * undefined when there isn't one. Pure — operates on the file text.
 */
export function extractFrontmatter(source: string): string | undefined {
  // Frontmatter must be the very first thing (optionally after a BOM/blank).
  const trimmed = source.replace(/^﻿/, '')
  if (!trimmed.startsWith('---')) {
    return undefined
  }
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) {
    return undefined
  }
  return trimmed.slice(trimmed.indexOf('\n') + 1, end)
}

/**
 * Read a top-level scalar frontmatter key's value, or undefined.
 */
export function frontmatterValue(
  frontmatter: string,
  key: string,
): string | undefined {
  const lines = frontmatter.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // Top-level key (no leading whitespace) `key: value`.
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`).exec(line)
    if (m) {
      // Strip one leading or trailing quote char (a YAML-style quoted scalar).
      return m[1]!.trim().replace(/^['"]|['"]$/g, '') // socket-lint: allow uncommented-regex
    }
  }
  return undefined
}

/**
 * Classify a single skill dir. Returns a defect or undefined when well-formed.
 */
export function classifySkill(
  skillsDir: string,
  name: string,
): SkillDefect | undefined {
  const skillMd = path.join(skillsDir, name, 'SKILL.md')
  if (!existsSync(skillMd)) {
    return {
      name,
      reason: 'no-skill-md',
      detail: `directory has no SKILL.md (a skill needs an agent-facing contract; an engine/test alone is a half-built skill)`,
    }
  }
  const source = readFileSync(skillMd, 'utf8')
  const frontmatter = extractFrontmatter(source)
  if (frontmatter === undefined) {
    return {
      name,
      reason: 'no-frontmatter',
      detail: `SKILL.md has no leading \`---\` … \`---\` frontmatter block`,
    }
  }
  const fmName = frontmatterValue(frontmatter, 'name')
  if (!fmName) {
    return { name, reason: 'no-name', detail: `frontmatter has no \`name:\`` }
  }
  if (fmName !== name) {
    return {
      name,
      reason: 'name-mismatch',
      detail: `frontmatter \`name: ${fmName}\` does not match directory \`${name}\` (the loader + mirror key on name == dir)`,
    }
  }
  const description = frontmatterValue(frontmatter, 'description')
  if (!description) {
    return {
      name,
      reason: 'no-description',
      detail: `frontmatter has no \`description:\` (the trigger text the model uses to find the skill)`,
    }
  }
  return undefined
}

export function findSkillDefects(skillsDir: string): SkillDefect[] {
  let entries: string[]
  try {
    entries = readdirSync(skillsDir)
  } catch {
    return []
  }
  const defects: SkillDefect[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === '_shared' || name.startsWith('.')) {
      continue
    }
    try {
      if (!statSync(path.join(skillsDir, name)).isDirectory()) {
        continue
      }
    } catch {
      continue
    }
    const defect = classifySkill(skillsDir, name)
    if (defect) {
      defects.push(defect)
    }
  }
  defects.sort((a, b) => a.name.localeCompare(b.name))
  return defects
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const skillsDir = path.join(REPO_ROOT, '.claude', 'skills', 'fleet')
  const defects = findSkillDefects(skillsDir)

  if (defects.length) {
    logger.fail(
      '[check-skills-are-well-formed] skill directory is not a well-formed skill:',
    )
    for (let i = 0, { length } = defects; i < length; i += 1) {
      const d = defects[i]!
      logger.error(`  ✗ ${d.name} — ${d.detail}`)
    }
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.success(
      '[check-skills-are-well-formed] every skill has a SKILL.md with a matching name + description.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
