/**
 * @file Slot builder for the llms.txt AI fill step. Assembles the list of
 *   named prose slots and their source text from deterministic extraction
 *   output. Also owns the verbatim generation prompt template.
 */

import type { LlmsSection, ProseSlot, RepoFacts } from './types.mts'

/**
 * The verbatim generation prompt — placeholders filled by buildPrompt().
 */
export const GENERATION_PROMPT_TEMPLATE = `\
You are filling prose slots in a generated llms.txt file (per the llmstxt.org\
 spec) for the repository "\${repoName}". The file's structure, links, names,\
 and paths are already fixed by a deterministic generator — you write ONLY the\
 short prose strings for the slots listed below.

Rules — every one is mandatory:
1. Output RAW JSON only: a single object {"slots":{"<id>":"<text>",...}} with\
 EXACTLY one entry per requested slot id. No markdown fences, no commentary,\
 no keys other than the requested ids.
2. Use ONLY facts present in the slot's SOURCE text and the shared REPO FACTS\
 below. Never invent file paths, module names, exports, commands, versions,\
 or capabilities. If a SOURCE is too thin to say anything specific, write a\
 plain generic description of what the linked file is — do not guess.
3. No links, no URLs, no file paths in your text (the renderer owns those):\
 never emit "](", "http", "./", "../", or a bare filename with an extension.
4. One line per slot: no newline characters. Stay within each slot's CHAR\
 BUDGET. Plain text; inline backticks are allowed for identifiers that\
 appear in the SOURCE.
5. Style: lead with what the thing is or does; start with a noun or verb —\
 never "This file", "This module", "A file that"; no hedging words\
 ("essentially", "simply", "basically"); no marketing adjectives; sentence\
 case. Link notes end WITHOUT a period; the summary ends WITH a period.
6. The "summary" slot (when present) is the blockquote summary of the whole\
 repository: one or two sentences a coding agent needs before anything\
 else — what the project is, what it ships, and who consumes it. Ground it\
 in REPO FACTS; mention the package/install name when the repo publishes.

REPO FACTS:
\${factsJson}

SLOTS (one per line: id | char budget | source):
\${slotsBlock}`

/**
 * Build the list of prose slots from repo facts and discovered sections.
 * Slots are assembled in a stable order so regen matching is deterministic.
 */
export function buildSlots(
  facts: RepoFacts,
  sections: LlmsSection[],
): ProseSlot[] {
  const slots: ProseSlot[] = []

  // Summary slot — always present; sourced from README lead.
  slots.push({
    charBudget: 280,
    id: 'summary',
    source: facts.readmeLead ?? `${facts.repoName} — no README found.`,
  })

  // Per-link note slots — one per link that has non-empty source text.
  for (const section of sections) {
    for (const link of section.links) {
      if (link.note === undefined) {
        // No source text available — skip, deterministic fallback will be used.
        continue
      }
      const id = `note:${section.title.toLowerCase()}:${link.name.toLowerCase().replace(/\s+/g, '-')}`
      slots.push({
        charBudget: 100,
        id,
        source: link.note,
      })
    }
  }

  return slots
}

/**
 * Fill the generation prompt template with repo name, facts JSON, and
 * the assembled slots block.
 */
export function buildPrompt(
  repoName: string,
  facts: RepoFacts,
  slots: ProseSlot[],
): string {
  const factsJson = JSON.stringify(
    {
      layout: facts.layout,
      license: facts.license,
      name: facts.repoName,
      nodeFloor: facts.nodeFloor,
      version: facts.version,
    },
    undefined,
    2,
  )

  const slotsBlock = slots
    .map(s => `${s.id} | ${s.charBudget} | ${s.source}`)
    .join('\n')

  return GENERATION_PROMPT_TEMPLATE.replace('${repoName}', repoName)
    .replace('${factsJson}', factsJson)
    .replace('${slotsBlock}', slotsBlock)
}
