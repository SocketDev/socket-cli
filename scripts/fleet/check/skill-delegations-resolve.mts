#!/usr/bin/env node
/**
 * @file Every command that delegates to a skill in prose ("Run the `<name>`
 *   skill") must name a skill that EXISTS
 *   (.claude/skills/{fleet,repo}/<name>/SKILL.md). The dead-reference twin of
 *   doc-references-resolve (which validates `node <script>` refs) and
 *   pnpm-run-citations-resolve (`pnpm run <name>`) — the skill-NAME surface
 *   those two leave uncovered. When a skill is renamed/moved/deleted and a
 *   command's prose isn't updated, the delegation silently rots and the command
 *   points at nothing. Exit codes: 0 — every delegation resolves; 1 — a command
 *   cites a missing skill. Usage: node
 *   scripts/fleet/check/skill-delegations-resolve.mts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// A command→skill delegation: "Run/Invoke(s)/via/using the `<name>` skill". The
// backtick/quote around the name is REQUIRED so plain prose ("run the security
// scan") never false-matches — only an explicit `name`-in-code reference counts.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const DELEGATION_RE =
  /\b(?:invokes?|run|using|via) the [`'"]([a-z][a-z0-9-]*)[`'"] skill\b/gi

// Cited skill names in a command markdown, deduped in first-seen order.
export function extractSkillDelegations(content: string): string[] {
  const seen = new Set<string>()
  for (const m of content.matchAll(DELEGATION_RE)) {
    seen.add(m[1]!)
  }
  return [...seen]
}

// Every skill name that exists under .claude/skills/{fleet,repo}/<name>/SKILL.md.
export function existingSkillNames(repoRoot: string): Set<string> {
  const names = new Set<string>()
  for (const tier of ['fleet', 'repo']) {
    const dir = path.join(repoRoot, '.claude/skills', tier)
    if (!existsSync(dir)) {
      continue
    }
    for (const name of readdirSync(dir)) {
      if (existsSync(path.join(dir, name, 'SKILL.md'))) {
        names.add(name)
      }
    }
  }
  return names
}

// Command markdown files under .claude/commands/**.
function commandFiles(repoRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(dir)) {
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(abs)
      }
    }
  }
  walk(path.join(repoRoot, '.claude/commands'))
  return out
}

async function main(): Promise<void> {
  const skills = existingSkillNames(REPO_ROOT)
  const errors: string[] = []
  for (const file of commandFiles(REPO_ROOT)) {
    for (const name of extractSkillDelegations(readFileSync(file, 'utf8'))) {
      if (!skills.has(name)) {
        errors.push(
          `${path.relative(REPO_ROOT, file)} delegates to the \`${name}\` skill, ` +
            `which has no .claude/skills/{fleet,repo}/${name}/SKILL.md.\n` +
            `    Fix: correct the skill name, or the command points at nothing.`,
        )
      }
    }
  }
  if (errors.length) {
    logger.error(`skill-delegations-resolve: ${errors.length} finding(s):`)
    for (let i = 0, { length } = errors; i < length; i += 1) {
      logger.error(`  ${errors[i]!}`)
    }
    process.exitCode = 1
    return
  }
  logger.success('every command→skill delegation resolves to a real skill.')
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`skill-delegations-resolve failed: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
