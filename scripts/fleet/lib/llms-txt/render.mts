/**
 * @file Renderer and parser for the llms.txt document format. Renders a
 *   structured skeleton (H1, facts zone, H2 sections) to a string conforming
 *   to the llmstxt.org spec, and parses an existing llms.txt back to a
 *   structural skeleton for freshness comparison. 16 KB hard cap enforced on
 *   render output.
 */

import type { LlmsSection, LlmsStructure, RepoFacts } from './types.mts'

const HARD_CAP_BYTES = 16 * 1024

/**
 * Render the facts zone — a short fixed block between the H1 and the first
 * H2. Uses a markdown table for compact, agent-readable output.
 */
function renderFacts(facts: RepoFacts): string {
  const rows: string[] = []
  if (facts.version !== undefined) rows.push(`| version | ${facts.version} |`)
  if (facts.nodeFloor !== undefined) rows.push(`| node | ${facts.nodeFloor} |`)
  rows.push(`| layout | ${facts.layout} |`)
  if (facts.license !== undefined) rows.push(`| license | ${facts.license} |`)
  rows.push(`| package manager | pnpm (from repo root) |`)
  if (rows.length === 0) return ''
  return `| key | value |\n| --- | --- |\n${rows.join('\n')}\n`
}

/**
 * Render a single link line.
 */
function renderLink(
  name: string,
  url: string,
  note: string | undefined,
): string {
  const noteStr = note !== undefined ? `: ${note}` : ''
  return `- [${name}](${url})${noteStr}`
}

/**
 * Render a complete llms.txt document. Empty sections are omitted.
 * Output is truncated at HARD_CAP_BYTES with a trailing note.
 */
export function renderDocument(
  facts: RepoFacts,
  summary: string,
  sections: LlmsSection[],
  filledNotes: Record<string, string>,
): string {
  const parts: string[] = []

  // H1.
  parts.push(`# ${facts.repoName}`)
  parts.push('')

  // Blockquote summary.
  parts.push(`> ${summary}`)
  parts.push('')

  // Facts zone.
  const factsZone = renderFacts(facts)
  if (factsZone.length > 0) {
    parts.push(factsZone)
  }

  // Sections — omit empty.
  for (const section of sections) {
    if (section.links.length === 0) continue
    parts.push(`## ${section.title}`)
    parts.push('')
    for (const link of section.links) {
      // Filled note overrides deterministic note.
      const noteKey = `note:${section.title.toLowerCase()}:${link.name.toLowerCase().replace(/\s+/g, '-')}`
      const note = filledNotes[noteKey] ?? link.note
      parts.push(renderLink(link.name, link.url, note))
    }
    parts.push('')
  }

  let rendered = parts.join('\n').trimEnd() + '\n'

  // Hard cap enforcement.
  const bytes = Buffer.byteLength(rendered, 'utf8')
  if (bytes > HARD_CAP_BYTES) {
    // Truncate and append a note.
    const cap = HARD_CAP_BYTES - 64
    rendered =
      rendered.slice(0, cap) + '\n\n<!-- truncated: exceeds 16 KB cap -->\n'
  }

  return rendered
}

/**
 * Parse the structural skeleton from an existing llms.txt string for
 * freshness comparison. Only H1, H2 titles, and link [name](url) pairs are
 * extracted — prose is never compared.
 */
export function parseStructure(content: string): LlmsStructure {
  const lines = content.split('\n')
  let h1 = ''
  const sectionTitles: string[] = []
  const sectionLinks: Record<string, Array<[string, string]>> = {}
  let currentSection: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ') && h1 === '') {
      h1 = trimmed.slice(2).trim()
      continue
    }
    if (trimmed.startsWith('## ')) {
      currentSection = trimmed.slice(3).trim()
      sectionTitles.push(currentSection)
      sectionLinks[currentSection] = []
      continue
    }
    if (currentSection !== undefined && trimmed.startsWith('- [')) {
      // Extract [name](url) from the link line.
      const match = /^- \[([^\]]+)\]\(([^)]+)\)/.exec(trimmed)
      if (match !== null) {
        sectionLinks[currentSection]!.push([match[1]!, match[2]!])
      }
    }
  }

  return { h1, sectionLinks, sectionTitles }
}

/**
 * Compare two structural skeletons for freshness. Returns true when
 * structures are equivalent (same H1, same sections + links in order).
 */
export function structuresMatch(a: LlmsStructure, b: LlmsStructure): boolean {
  if (a.h1 !== b.h1) return false
  if (a.sectionTitles.length !== b.sectionTitles.length) return false
  for (let i = 0; i < a.sectionTitles.length; i += 1) {
    if (a.sectionTitles[i] !== b.sectionTitles[i]) return false
    const aLinks = a.sectionLinks[a.sectionTitles[i]!] ?? []
    const bLinks = b.sectionLinks[b.sectionTitles[i]!] ?? []
    if (aLinks.length !== bLinks.length) return false
    for (let j = 0; j < aLinks.length; j += 1) {
      if (aLinks[j]![0] !== bLinks[j]![0] || aLinks[j]![1] !== bLinks[j]![1])
        return false
    }
  }
  return true
}
