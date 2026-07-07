/**
 * Deterministic parse/aggregate helpers for the patching-findings skill: the
 * five-tag patch extraction (+ entity unescape + NONE detection), the reviewer
 * trailing-block parse (+ a style-vs-verdict contradiction FLAG), and the
 * Phase-5 count aggregation + PATCHES.md render.
 *
 * Pure + exported. The patch GENERATION, the reviewer's ACCEPT/REJECT call, the
 * apply step, and variant analysis stay agent-driven; this only parses their
 * structured replies and tallies. The style-contradiction is a flag only — it
 * NEVER alters the reviewer's verdict (that is the gate; a script silently
 * downgrading a contradictory ACCEPT would remove the model's call).
 */

const PATCH_TAGS = [
  'patch_diff',
  'rationale',
  'variants_checked',
  'bypass_considered',
  'test_note',
] as const

export type PatchTag = (typeof PATCH_TAGS)[number]

export type PatchStatus = 'patched' | 'no_patch'

export interface ParsedPatch {
  status: PatchStatus
  patch_diff: string
  rationale: string
  variants_checked: string
  bypass_considered: string
  test_note: string
}

// Unescape the HTML entities an agent may emit inside a tagged block before the
// diff is used (the prompt tolerates `&lt;`/`&gt;`/`&amp;`).
export function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

function extractTag(text: string, tag: string): string {
  // Tolerate surrounding code fences: capture the inner text of <tag>…</tag>.
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'u')
  const m = re.exec(text)
  if (!m) {
    return ''
  }
  return unescapeEntities(m[1]!.trim())
}

// Parse the five tagged blocks from a patch-agent reply. A `<patch_diff>` of
// NONE/empty → status no_patch (the finding isn't fixable as described).
export function parsePatchResult(text: string): ParsedPatch {
  const out: Record<PatchTag, string> = {
    bypass_considered: '',
    patch_diff: '',
    rationale: '',
    test_note: '',
    variants_checked: '',
  }
  for (let i = 0, { length } = PATCH_TAGS; i < length; i += 1) {
    out[PATCH_TAGS[i]!] = extractTag(text, PATCH_TAGS[i]!)
  }
  const diff = out.patch_diff
  const status: PatchStatus =
    diff === '' || diff.toUpperCase() === 'NONE' ? 'no_patch' : 'patched'
  return { ...out, status }
}

export type Review = 'ACCEPT' | 'REJECT'

export interface ParsedReview {
  review: Review | undefined
  style_score: number | undefined
  out_of_scope_hunks: string[]
  review_reason: string
  // A style score < 5 under an ACCEPT verdict contradicts the prompt's rule
  // ("ACCEPT requires style >= 5"). Surfaced as a FLAG for the human/agent to
  // notice — it does NOT change the verdict, which is the reviewer's gate call.
  style_contradiction: boolean
}

const STYLE_FLOOR = 5

// Parse the reviewer's trailing block (REVIEW / STYLE_SCORE / OUT_OF_SCOPE_HUNKS
// / REASON). The verdict is taken verbatim; the style-contradiction is computed
// but never used to alter it.
export function parseReviewResult(text: string): ParsedReview {
  const reviewMatch = /REVIEW:\s*(ACCEPT|REJECT)/iu.exec(text)
  const review = reviewMatch
    ? (reviewMatch[1]!.toUpperCase() as Review)
    : undefined
  const styleMatch = /STYLE_SCORE:\s*(\d+)/iu.exec(text)
  const styleScore = styleMatch ? Number(styleMatch[1]) : undefined
  const hunksMatch = /OUT_OF_SCOPE_HUNKS:\s*(.+)/iu.exec(text)
  const hunksRaw = hunksMatch ? hunksMatch[1]!.trim() : ''
  const outOfScopeHunks =
    hunksRaw === '' || hunksRaw.toLowerCase() === 'none'
      ? []
      : hunksRaw
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
  // `REASON:` then group 1 lazily captures everything up to the first blank
  // line (a `\n` + optional whitespace + `\n`) or end of input.
  const reasonMatch = /REASON:\s*([\s\S]+?)(?:\n\s*\n|$)/iu.exec(text)
  const reviewReason = reasonMatch ? reasonMatch[1]!.trim() : ''
  const contradiction =
    review === 'ACCEPT' && styleScore !== undefined && styleScore < STYLE_FLOOR
  return {
    out_of_scope_hunks: outOfScopeHunks,
    review,
    review_reason: reviewReason,
    style_contradiction: contradiction,
    style_score: styleScore,
  }
}

export interface PatchOutcome {
  id: string
  title?: string | undefined
  severity?: string | undefined
  file?: string | undefined
  line?: number | undefined
  status: PatchStatus
  review?: Review | undefined
  applied: boolean
  commit_sha?: string | undefined
  rationale?: string | undefined
  variants_checked?: string | undefined
  review_reason?: string | undefined
  skip_reason?: string | undefined
}

export interface PatchSummary {
  total: number
  applied: number
  rejected: number
  skipped: number
}

// Tally outcomes (Phase 5): applied = landed ACCEPTs; rejected = reviewer
// REJECTs; skipped = no-patch / apply-failed / no-location.
export function summarizeOutcomes(
  outcomes: readonly PatchOutcome[],
): PatchSummary {
  let applied = 0
  let rejected = 0
  let skipped = 0
  for (let i = 0, { length } = outcomes; i < length; i += 1) {
    const o = outcomes[i]!
    if (o.applied) {
      applied += 1
    } else if (o.review === 'REJECT') {
      rejected += 1
    } else {
      skipped += 1
    }
  }
  return { applied, rejected, skipped, total: outcomes.length }
}

function loc(o: PatchOutcome): string {
  return o.line === undefined ? (o.file ?? '?') : `${o.file}:${o.line}`
}

// Render PATCHES.md (Phase 5): the input line + Landed / Rejected / Skipped
// sections from the outcomes.
export function renderPatchesMd(input: {
  findingsPath: string
  repo: string
  outcomes: readonly PatchOutcome[]
}): string {
  const s = summarizeOutcomes(input.outcomes)
  const lines: string[] = []
  lines.push('# Security Patches')
  lines.push('')
  lines.push(
    `**Input:** ${input.findingsPath} · **Repo:** ${input.repo} · ${s.total} findings → ${s.applied} applied, ${s.rejected} rejected, ${s.skipped} skipped`,
  )
  lines.push('')
  lines.push('## Landed')
  for (const o of input.outcomes) {
    if (!o.applied) {
      continue
    }
    lines.push(
      `### [${o.severity ?? '?'}] ${o.title ?? o.id} (${o.id}) · \`${loc(o)}\` · commit ${o.commit_sha ?? '?'}`,
    )
    lines.push(`**Rationale:** ${o.rationale ?? ''}`)
    lines.push(`**Variants checked:** ${o.variants_checked ?? ''}`)
    lines.push('')
  }
  lines.push('## Rejected by reviewer')
  for (const o of input.outcomes) {
    if (!o.applied && o.review === 'REJECT') {
      lines.push(`- ${o.id} ${o.title ?? ''} — ${o.review_reason ?? ''}`)
    }
  }
  lines.push('')
  lines.push('## Skipped')
  for (const o of input.outcomes) {
    if (!o.applied && o.review !== 'REJECT') {
      lines.push(`- ${o.id} ${o.title ?? ''} — ${o.skip_reason ?? o.status}`)
    }
  }
  return `${lines.join('\n')}\n`
}
