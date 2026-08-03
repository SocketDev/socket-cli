/**
 * @file Every fleet subagent definition must point at the repo's rules. A
 *   subagent runs with its own context: it does NOT inherit the main
 *   session's memory of CLAUDE.md, so an agent definition that never names
 *   the rules produces an actor who learns them one tool-refusal at a time —
 *   or writes something the hooks do not happen to guard.
 *   The fleet hooks DO bind subagents (they fire at the tool layer, on every
 *   tool call, whoever makes it), so this is not about enforcement — it is
 *   about an agent knowing the rule before it spends a turn getting blocked
 *   by it. `pr-feedback.md` was the one definition missing the citation
 *   (2026-08-01), and it is the broadest-privileged agent in the fleet: it
 *   commits, pushes, and comments as the operator.
 *   The check is deliberately shallow — it asserts a CITATION exists, not
 *   what it says. A definition that names CLAUDE.md has an author who
 *   thought about the rules; policing the wording would be a style gate
 *   pretending to be a correctness one.
 *   Usage: node scripts/fleet/check/agents-have-rule-citations.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// The citation any of these satisfies: the rules file itself, or the docs
// tree it links. An agent that names either has been pointed at the rules.
const CITATIONS = ['CLAUDE.md', 'docs/agents.md/fleet/']

/**
 * The agent definitions that cite no rules source. Pure over the (name,
 * body) pairs so the scan is testable without a filesystem.
 */
export function agentsMissingCitation(
  defs: ReadonlyArray<{ body: string; name: string }>,
): string[] {
  const missing: string[] = []
  for (let i = 0, { length } = defs; i < length; i += 1) {
    const def = defs[i]!
    if (!CITATIONS.some(c => def.body.includes(c))) {
      missing.push(def.name)
    }
  }
  return missing
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const agentsDir = path.join(REPO_ROOT, '.claude/agents/fleet')
  if (!existsSync(agentsDir)) {
    if (!quiet) {
      logger.log('agents-have-rule-citations: no fleet agents here.')
    }
    return
  }
  const defs = readdirSync(agentsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      body: readFileSync(path.join(agentsDir, f), 'utf8'),
      name: f,
    }))
  const missing = agentsMissingCitation(defs)
  if (missing.length === 0) {
    if (!quiet) {
      logger.success(
        `all ${defs.length} fleet agent definition(s) cite the rules.`,
      )
    }
    return
  }
  logger.fail(
    [
      `${missing.length} fleet agent definition(s) cite no rules source:`,
      ...missing.map(m => `  - .claude/agents/fleet/${m}`),
      '',
      'A subagent runs in its OWN context and does not inherit the main',
      "session's memory of CLAUDE.md. Without a citation it learns the",
      'conventions one tool-refusal at a time.',
      '',
      `Fix: name ${CITATIONS[0]} (or the ${CITATIONS[1]} docs it links) in the`,
      "definition's prose, alongside what the agent is for.",
    ].join('\n'),
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  }
}
