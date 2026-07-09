#!/usr/bin/env node
/**
 * @file Llms.txt generator for fleet repos. Deterministic extraction builds
 *   the full skeleton (H1, facts zone, six H2 sections); AI fills ONLY the
 *   named prose slots (blockquote summary + link notes). Any AI failure after
 *   one retry exits 1 writing NOTHING — never a partial file.
 *   Flags:
 *   --check   Parse-compare structural skeleton only; exit 1 when stale.
 *   --no-ai   Skip AI fill; render with deterministic fallback prose.
 *   --quiet   Suppress info logs.
 *   Usage: node scripts/fleet/make-llms-txt.mts [--check] [--no-ai] [--quiet]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { fillSlots, hasClaudeCli } from './lib/llms-txt/ai.mts'
import { extractRepoFacts } from './lib/llms-txt/extract.mts'
import {
  parseStructure,
  renderDocument,
  structuresMatch,
} from './lib/llms-txt/render.mts'
import { buildSections } from './lib/llms-txt/sections.mts'
import { buildPrompt, buildSlots } from './lib/llms-txt/slots.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void (async () => {
    await main()
  })()
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const checkOnly = argv.includes('--check')
  const noAi = argv.includes('--no-ai')
  const quiet = argv.includes('--quiet')

  const outPath = path.join(REPO_ROOT, 'llms.txt')

  try {
    const facts = extractRepoFacts(REPO_ROOT)
    const sections = buildSections(REPO_ROOT, facts)

    if (checkOnly) {
      if (!existsSync(outPath)) {
        logger.error(
          'llms.txt is missing — run: node scripts/fleet/make-llms-txt.mts',
        )
        process.exitCode = 1
        return
      }
      const current = readFileSync(outPath, 'utf8')
      const currentStruct = parseStructure(current)
      const skeletonDoc = renderDocument(facts, facts.repoName, sections, {})
      const newStruct = parseStructure(skeletonDoc)
      if (!structuresMatch(currentStruct, newStruct)) {
        logger.error(
          'llms.txt is stale — run: node scripts/fleet/make-llms-txt.mts',
        )
        process.exitCode = 1
        return
      }
      if (!quiet) {
        logger.info('llms.txt is current')
      }
      return
    }

    // Harvest existing prose when the structure has not changed — avoids an
    // unnecessary AI call on format-only or no-op reruns.
    let existingNotes: Record<string, string> = {}
    if (existsSync(outPath)) {
      const existing = readFileSync(outPath, 'utf8')
      const existingStruct = parseStructure(existing)
      const skeletonDoc = renderDocument(facts, facts.repoName, sections, {})
      const newStruct = parseStructure(skeletonDoc)
      if (structuresMatch(existingStruct, newStruct)) {
        existingNotes = harvestProse(existing)
        if (!quiet) {
          logger.info('structure unchanged — reusing existing prose')
        }
      }
    }

    let filledNotes: Record<string, string> = existingNotes

    if (!noAi && Object.keys(existingNotes).length === 0) {
      const slots = buildSlots(facts, sections)
      if (slots.length > 0) {
        const canUseAi = await hasClaudeCli(REPO_ROOT)
        if (!canUseAi) {
          if (!quiet) {
            logger.warn('claude CLI not found — rendering without AI fill')
          }
        } else {
          const charBudgets: Record<string, number> = {}
          for (const slot of slots) {
            charBudgets[slot.id] = slot.charBudget
          }
          const prompt = buildPrompt(facts.repoName, facts, slots)
          const result = await fillSlots(
            prompt,
            slots.map(s => s.id),
            charBudgets,
            REPO_ROOT,
          )
          if ('error' in result) {
            logger.error(`AI slot fill failed: ${result.error}`)
            process.exitCode = 1
            return
          }
          filledNotes = result.slots
          if (!quiet) {
            logger.info(`AI filled ${Object.keys(filledNotes).length} slots`)
          }
        }
      }
    }

    const summary =
      (filledNotes['summary'] ?? facts.readmeLead) ||
      `${facts.repoName} — scaffolding and tooling for the Socket fleet.`

    const rendered = renderDocument(facts, summary, sections, filledNotes)
    writeFileSync(outPath, rendered, 'utf8')

    if (!quiet) {
      logger.info(`wrote ${outPath} (${Buffer.byteLength(rendered)} bytes)`)
    }
  } catch (e) {
    logger.error(`make-llms-txt failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

/**
 * Harvest existing prose from a rendered llms.txt. Extracts the blockquote
 * summary and link note texts from a prior render so the AI call is skipped
 * when the structure has not changed. Returns a slot-keyed map matching the
 * same id scheme used in buildSlots.
 */
function harvestProse(content: string): Record<string, string> {
  const notes: Record<string, string> = {}
  const lines = content.split('\n')
  let currentSection: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('> ') && !('summary' in notes)) {
      notes['summary'] = trimmed.slice(2).trim()
      continue
    }

    if (trimmed.startsWith('## ')) {
      currentSection = trimmed.slice(3).trim()
      continue
    }

    if (currentSection !== undefined && trimmed.startsWith('- [')) {
      // Markdown link bullet: `- [title](url): description` — captures the link
      // label and the trailing description text after the colon.
      const match = /^- \[([^\]]+)\]\([^)]+\): (.+)$/.exec(trimmed)
      if (match !== null) {
        const linkName = match[1]!.toLowerCase().replace(/\s+/g, '-')
        const id = `note:${currentSection.toLowerCase()}:${linkName}`
        notes[id] = match[2]!
      }
    }
  }

  return notes
}
