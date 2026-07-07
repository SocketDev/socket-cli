#!/usr/bin/env node
/**
 * @file Resolve a recorded MEMORY lesson into its two canonical code surfaces
 *   via the socket-lib AI helper — so nobody hand-juggles the 40KB CLAUDE.md
 *   byte budget or the defer-to-docs split again. The flow is: (1) record the
 *   lesson as a memory file (frontmatter + the _why_); (2) point this script at
 *   it. The memory file IS the agent's source-of-truth context, so it knows
 *   what to write. The agent then:
 *
 *   1. Adds a TERSE one-line `-` bullet to the right CLAUDE.md section (the `## 📚
 *      Wheelhouse Standards` fleet block for `--section fleet`, or the `## 🏗️
 *      …-Specific` postamble for `--section repo`), pointing at the doc.
 *   2. Creates (or extends) the detail doc at
 *      `docs/agents.md/{fleet,repo}/<topic>.md` from the memory's content. The
 *      agent owns the hard part: keeping the CLAUDE.md edit under the 40KB cap
 *      (claude-md-size-guard) and the per-section ≤8-line cap
 *      (claude-md-section-size-guard) by writing the bullet tersely and pushing
 *      all prose into the doc. Lockdown per the four-flag Programmatic-Claude
 *      rule via AI_PROFILE.create (Edit + Write, no Bash). Default dry-run;
 *      `--apply` writes. Usage: node scripts/fleet/codify-rule.mts --memory
 *      <path/to/memory.md> [--section fleet|repo] [--topic <kebab-name>]
 *      [--apply] --section + --topic are inferred from the memory frontmatter
 *      when omitted (type: feedback|project → fleet; the memory `name:` slug →
 *      topic).
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'
import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

export interface CodifyArgs {
  apply: boolean
  // The recorded memory file: frontmatter + the *why*. The agent's context.
  memory: string
  memoryPath: string
  section: 'fleet' | 'repo'
  topic: string
}

// Author prose, not heavy reasoning — sonnet/medium is the right tier (the
// CLAUDE.md token-spend rule: match model + effort to the job).
const MODEL = 'claude-sonnet-4-6'
const EFFORT = 'medium' as const

// Pull a `key: value` from a memory file's YAML frontmatter (top `---`…`---`
// block). The key may sit nested under `metadata:`. Returns undefined when
// absent. Tolerant — memory files are small + hand-authored, not arbitrary YAML.
export function frontmatterValue(
  memory: string,
  key: string,
): string | undefined {
  // Capture the leading `---\n … \n---` frontmatter block.
  const fm = /^---\n([\s\S]*?)\n---/.exec(memory)
  if (!fm) {
    return undefined
  }
  // Match `  <key>: <value>` on any frontmatter line; capture the trimmed value.
  const re = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm')
  const m = re.exec(fm[1]!)
  return m ? m[1]!.trim() : undefined
}

export function parseArgs(argv: readonly string[]): CodifyArgs {
  let apply = false
  let memoryPath: string | undefined
  let sectionArg: 'fleet' | 'repo' | undefined
  let topicArg: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
    } else if (arg === '--memory') {
      memoryPath = argv[++i]
    } else if (arg === '--section') {
      const v = argv[++i]
      if (v !== 'fleet' && v !== 'repo') {
        logger.fail(`--section must be 'fleet' or 'repo' (saw ${String(v)})`)
        process.exit(1)
      }
      sectionArg = v
    } else if (arg === '--topic') {
      topicArg = argv[++i]
    }
  }
  if (!memoryPath || !existsSync(memoryPath)) {
    logger.fail(
      `--memory must point at an existing memory file (saw ${String(memoryPath)})`,
    )
    process.exit(1)
  }
  const memory = readFileSync(memoryPath, 'utf8')
  if (!memory.trim()) {
    logger.fail(`Memory file is empty: ${memoryPath}`)
    process.exit(1)
  }
  // Infer section from the memory `type` when --section is omitted: feedback /
  // project lessons are fleet-wide disciplines by default; reference notes are
  // repo-scoped. Force with --section.
  const memType = frontmatterValue(memory, 'type')
  const section: 'fleet' | 'repo' =
    sectionArg ?? (memType === 'reference' ? 'repo' : 'fleet')
  // Infer topic from the memory `name:` slug (strip a feedback_/project_ prefix,
  // underscores → hyphens) when --topic is omitted.
  const rawName = frontmatterValue(memory, 'name') ?? ''
  const topic =
    topicArg ??
    rawName
      .replace(/^(?:feedback|project|reference|user)[_-]/, '')
      .replaceAll('_', '-')
  if (!topic || !/^[a-z][a-z0-9-]*$/.test(topic)) {
    logger.fail(
      `Could not derive a kebab topic (memory name=${String(rawName)}); pass --topic <kebab-name>.`,
    )
    process.exit(1)
  }
  return { apply, memory, memoryPath, section, topic }
}

// The CLAUDE.md section to append the bullet under, by scope.
function sectionAnchor(section: 'fleet' | 'repo'): string {
  return section === 'fleet'
    ? 'the `## 📚 Wheelhouse Standards` fleet-canonical block (between the BEGIN/END FLEET-CANONICAL markers)'
    : 'the `## 🏗️ …-Specific` project section (the repo-owned postamble, OUTSIDE the FLEET-CANONICAL markers)'
}

export function buildPrompt(args: CodifyArgs): string {
  const docRel = `docs/agents.md/${args.section}/${args.topic}.md`
  const claudeRel =
    args.section === 'fleet' ? 'template/CLAUDE.md' : 'CLAUDE.md'
  return [
    'You are codifying ONE recorded lesson into its two canonical code surfaces. The MEMORY below is your source of truth — it captures the rule AND the *why*. Make exactly two edits and nothing else.',
    '',
    `1. In ${claudeRel}, inside ${sectionAnchor(args.section)}, add a single terse \`-\` bullet (or fold into the nearest related bullet) that states the rule in ONE line and links to the detail doc \`${docRel}\`. HARD CONSTRAINT: the whole file must stay UNDER 40960 bytes and every \`###\` section body must stay ≤8 lines — so the bullet is a pointer + one-line "why", never the full prose. BIAS HARD TOWARD THE DOC: CLAUDE.md is an INDEX, not a manual — push every word of detail into \`docs/agents.md/{fleet,repo}/*\` and leave only the one-line rule + doc link behind. When a \`###\` section is already dense, prefer COLLAPSING its prose bullets into a compact reference list of \`[topic](docs/agents.md/${args.section}/<topic>.md)\` links (the detail already lives in those docs) rather than carrying the prose inline; if the section is near the cap, tighten or relocate neighboring wording into its doc to make room — never exceed the cap. Use the fleet voice (imperative, terse, 🚨 only for hard rules). Drop the memory's frontmatter, dates/SHAs/percentages, and any machine-local paths from what you write (generic, timeless phrasing).`,
    `2. Create or extend ${docRel} with the lesson as well-structured markdown (lowercase-kebab filename; level-1 title; sections for What / Why / How to apply / Enforcement). This doc is where all the prose lives — expand the memory's "why" + "how to apply" into full guidance. Keep it generic (no dates/SHAs/personal paths).`,
    '',
    '--- MEMORY (source of truth; do NOT copy verbatim — resolve it into the two surfaces) ---',
    args.memory.trim(),
    '--- END MEMORY ---',
    '',
    'Do not touch any other file. Do not run any command. After both edits, stop.',
  ].join('\n')
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prompt = buildPrompt(args)
  const docRel = `docs/agents.md/${args.section}/${args.topic}.md`
  const claudeRel =
    args.section === 'fleet' ? 'template/CLAUDE.md' : 'CLAUDE.md'

  logger.log(`codify-rule: section=${args.section} topic=${args.topic}`)
  logger.log(`  CLAUDE.md:  ${claudeRel} (add/fold a terse bullet)`)
  logger.log(`  detail doc: ${docRel} (create/extend)`)

  if (!args.apply) {
    logger.log('')
    logger.log('DRY RUN — pass --apply to spawn the agent. Prompt preview:')
    logger.log('')
    logger.log(prompt)
    return
  }

  const discovered = await discoverAiAgents({ repoRoot: REPO_ROOT })
  if (!('claude' in discovered)) {
    logger.fail(
      'claude CLI not on PATH — cannot codify. Install it or run dry.',
    )
    process.exitCode = 1
    return
  }

  // AI_PROFILE.create: Edit + Write (must create the doc), NO Bash — the
  // four-flag lockdown the Programmatic-Claude rule mandates. addDirs lets the
  // agent see template/ + docs/ under the repo root (already the cwd).
  const { exitCode, stderr } = await spawnAiAgent({
    ...AI_PROFILE.create,
    cwd: REPO_ROOT,
    effort: EFFORT,
    model: MODEL,
    prompt,
    timeoutMs: 5 * 60 * 1000,
  })
  if (exitCode !== 0) {
    logger.fail(`codify agent exited ${exitCode}: ${stderr.slice(0, 800)}`)
    process.exitCode = 1
    return
  }
  logger.success(
    `Codified ${args.topic}: bullet in ${claudeRel} + detail in ${docRel}. Review the diff, then commit + cascade.`,
  )
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
