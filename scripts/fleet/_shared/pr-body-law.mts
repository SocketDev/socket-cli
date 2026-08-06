/*
 * @file The PR-body law, as code. A `<details>` fold earns its place only when
 *   the reader can decide whether to open it WITHOUT opening it, and can act
 *   on what is inside without re-reading it. This module is the single
 *   importable statement of that contract so skills, agent prompts, and any
 *   future nudge cite the same rules instead of re-deriving them from prose.
 *   `docs/agents.md/fleet/prose-style-and-doctrine.md` governs WHEN a body
 *   folds; this governs the SHAPE inside the fold.
 *   The failure this prevents: folds whose summaries are bare labels and whose
 *   insides are paragraphs. A reader skimming the summary line learns nothing,
 *   so every fold has to be opened to find out whether it matters. The
 *   operator's verdict on one such body was that it read as a word dump. The
 *   corrected shape is the law below; that body, rewritten, is the fixture at
 *   `test/repo/unit/fixtures/pr-body-law/compliant-body.md`, which the
 *   validator must stay quiet on.
 *   The law, and why each clause exists:
 *
 *   - A summary carries the CLAIM. `What changed` gives a reader nothing to
 *     decide on; `The change - one home per case, plus the vars that outrank
 *     it` lets them skip the fold and still know the outcome. The shape that
 *     worked: short bold noun phrase, a spaced plain dash, specific claim.
 *     The separator was written as an em dash until 2026-08-05, when
 *     `prose-em-dashes-are-absent` banned that character outright; prescribing
 *     it here would have made every compliant PR body fail the other gate.
 *     `CLAIM_SEPARATOR_RE` still ACCEPTS an em dash, en dash, or colon so
 *     bodies written under the old shape keep validating.
 *   - A fold OPENS with its takeaway, then supports it. Conclusion first,
 *     evidence second — the lead-with-the-point rule the doctrine already
 *     applies at the top level, applied one level down. A fold that opens on a
 *     list or a code fence makes the reader assemble the point themselves.
 *   - Enumerable facts are a TABLE. Seven environment variables named in a
 *     paragraph are unreadable; a two-column `variable | what leaks without
 *     it` table is scannable and gives each row room for its own caveat.
 *     Trigger: three or more parallel items sharing a shape.
 *   - A status fold uses LABELED lines — **Ran** / **Did not run** /
 *     **Trade-off** / **CI is unaffected**. A reviewer whose only question is
 *     "did they actually test this" finds the answer without reading the
 *     paragraphs around it.
 *
 *   `prBodySmells` is ADVISORY, named so no caller mistakes it for a gate. It
 *   reports folds that look like the pre-rewrite shape and nothing more: the
 *   detectors are heuristics over markdown text, and the origin case (seven
 *   variables enumerated in a sentence) is deliberately NOT detected, because
 *   every prose-enumeration pattern tried also matched ordinary sentences.
 *   Do not wire this into a blocking check without evidence from real bodies
 *   that it does not false-positive.
 */

export type PrBodyRuleId =
  | 'informative-summary'
  | 'labeled-status-lines'
  | 'table-over-parallel-items'
  | 'takeaway-first'

/**
 * One `<details>` block, split at its `</summary>`.
 */
export interface PrBodyFold {
  /**
   * Everything after `</summary>`, trimmed.
   */
  body: string
  /**
   * The raw `<summary>` markup — run it through {@link summaryPlainText}.
   */
  summary: string
}

/**
 * One clause of the law, as data.
 */
export interface PrBodyLawEntry {
  id: PrBodyRuleId
  rule: string
}

/**
 * One advisory finding against one fold.
 */
export interface PrBodySmell {
  /**
   * What to do about it, in one sentence.
   */
  detail: string
  rule: PrBodyRuleId
  /**
   * The fold it was found in — its summary text, or `fold <n>` when the
   * summary is missing or empty.
   */
  where: string
}

/**
 * Summary texts that name a topic instead of stating a finding. Matched
 * against the whole normalized summary, so `The change — one home per case`
 * is untouched while a bare `The change` is not.
 */
export const GENERIC_SUMMARY_LABELS: ReadonlySet<string> = new Set([
  'additional context',
  'background',
  'changes',
  'changes made',
  'context',
  'details',
  'how it works',
  'implementation',
  'implementation notes',
  'more details',
  'more info',
  'motivation',
  'notes',
  'other notes',
  'summary',
  'test plan',
  'testing',
  'the change',
  'verification',
  'what changed',
  'what i did',
  'why',
])

/**
 * Words a claim needs before it counts as one. Below this the summary is a
 * label with decoration.
 */
export const MIN_CLAIM_WORDS = 3

/**
 * Parallel items that tip a list into table territory.
 */
export const MIN_PARALLEL_ITEMS = 3

/**
 * Prose blocks a status fold may hold before it needs labels.
 */
export const MIN_STATUS_BLOCKS = 3

/**
 * Bold labels that make a status fold scannable. One label among four
 * paragraphs is decoration, not structure.
 */
export const MIN_STATUS_LABELS = 2

/**
 * The four clauses, in teaching order (not sorted — the order is the lesson).
 */
export const PR_BODY_LAW: readonly PrBodyLawEntry[] = Object.freeze([
  Object.freeze({
    id: 'informative-summary' as PrBodyRuleId,
    rule: 'A `<summary>` states the finding, never a label: a short bold noun phrase, a spaced plain dash, then the specific claim. The reader decides whether to expand without expanding.',
  }),
  Object.freeze({
    id: 'takeaway-first' as PrBodyRuleId,
    rule: 'Each fold opens with its takeaway, then supports it — conclusion first, evidence second, the same lead-with-the-point rule the top level follows.',
  }),
  Object.freeze({
    id: 'table-over-parallel-items' as PrBodyRuleId,
    rule: 'Enumerable facts become a table, never a paragraph or a bullet run. Three or more parallel items with a shared shape earn two columns, which gives each row room for its own caveat.',
  }),
  Object.freeze({
    id: 'labeled-status-lines' as PrBodyRuleId,
    rule: 'Status sections use labeled lines — **Ran** / **Did not run** / **Trade-off** / **CI is unaffected** — so a reviewer asking only "did they actually test this" finds it instantly.',
  }),
])

/**
 * The law as a verbatim prompt block, for any agent prompt that may write a
 * PR body. Paraphrase is how "use a specific summary" decayed into a label.
 */
export const PR_BODY_LAW_PROMPT = [
  'PR-body law for every `<details>` fold (verbatim, non-negotiable):',
  ...PR_BODY_LAW.map(entry => `- ${entry.rule}`),
].join('\n')

// A summary separator on READ: a spaced plain dash (what the law now
// prescribes), or an em dash, en dash, or colon, which older bodies used.
// Reading stays permissive so a body written before the em-dash ban still
// validates; only the prescription changed.
const CLAIM_SEPARATOR_RE = /\s+[—–]\s+|\s+-\s+|:\s+/
const DETAILS_RE = /<details\b[^>]*>([\s\S]*?)<\/details>/gi
const FENCE_RE = /^\s{0,3}(?:```|~~~)/
const LEAD_BOLD_RE = /^\*\*[^*]+\*\*/
const LEAD_CODE_RE = /^`[^`]+`/
// A `term - description` list-item lead. The spaced-hyphen arm is written
// separately (`\s-`) rather than folded into the character class, so a term
// that CONTAINS hyphens (`no-fork-guard - blocks a live edit`) still reads as
// one term. Without it, the registry-line shape the em-dash ban produces would
// classify as plain prose and the parallel-items table nudge would go quiet.
const LEAD_TERM_RE = /^[^\s—–:]{1,40}(?:\s*[—–:]|\s-)\s/
// One markdown list item: up to 3 spaces of indent, a bullet (`-`, `*`, `+`)
// or an ordered marker (`1.` / `1)`), a space, then the captured text, which
// must start with a non-space so a bare bullet does not match.
const LIST_ITEM_RE = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(\S.*)$/
// Raw material a fold must not open on: a heading, a list, a table row, or a
// code fence. A bold-label line (`**Ran:**`) is a takeaway and passes.
const NOT_A_TAKEAWAY_RE = /^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||```|~~~)/
// A verb that reads as a status report rather than a finding: "checked",
// "ran"/"run", "test"/"tested"/"testing"/"tests", "validated"/"validation",
// "verify"/"verified"/"verification". Word-bounded so "contested" is not a
// hit, case-insensitive so a sentence-leading "Ran" counts.
const STATUS_SUMMARY_RE =
  /\b(?:checked|ran|run|test(?:ed|ing|s)?|validat(?:ed|ion)|verif(?:ication|ied|y))\b/i
const SUMMARY_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * The first non-blank line of a fold, trimmed of trailing space. Empty when
 * the fold has no content.
 */
export function firstContentLine(text: string): string {
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trim()) {
      return line.trimEnd()
    }
  }
  return ''
}

/**
 * True when the summary names a topic rather than stating a finding.
 */
export function isGenericSummary(summary: string): boolean {
  const text = summaryPlainText(summary)
  if (!text) {
    return true
  }
  if (wordCount(summaryClaim(text)) >= MIN_CLAIM_WORDS) {
    return false
  }
  const head = text.split(CLAIM_SEPARATOR_RE)[0]!.trim()
  const normalized = head
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return GENERIC_SUMMARY_LABELS.has(normalized) || wordCount(head) < 4
}

/**
 * Every maximal run of consecutive list items in `text`, as item text with
 * the bullet marker stripped. A single blank line inside a run does not break
 * it — a loose markdown list is still one list.
 */
export function parallelItemRuns(text: string): string[][] {
  const runs: string[][] = []
  const lines = text.split('\n')
  let current: string[] = []
  let blanks = 0
  let fenced = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      continue
    }
    const match = LIST_ITEM_RE.exec(line)
    if (match) {
      current.push(match[1]!.trim())
      blanks = 0
      continue
    }
    if (!line.trim() && current.length && blanks === 0) {
      blanks = 1
      continue
    }
    if (current.length) {
      runs.push(current)
      current = []
    }
    blanks = 0
  }
  if (current.length) {
    runs.push(current)
  }
  return runs
}

/**
 * The lead-token shape of one list item: `bold`, `code`, `term` (a bare word
 * followed by a separator), or `prose`. Items sharing a non-prose shape are
 * the table trigger.
 */
export function parallelItemShape(item: string): string {
  if (LEAD_BOLD_RE.test(item)) {
    return 'bold'
  }
  if (LEAD_CODE_RE.test(item)) {
    return 'code'
  }
  if (LEAD_TERM_RE.test(item)) {
    return 'term'
  }
  return 'prose'
}

/**
 * Every `<details>` block in the body, in document order.
 */
export function prBodyFolds(body: string): PrBodyFold[] {
  const folds: PrBodyFold[] = []
  const re = new RegExp(DETAILS_RE.source, DETAILS_RE.flags)
  let match = re.exec(body)
  while (match) {
    const inner = match[1]!
    const summaryMatch = SUMMARY_RE.exec(inner)
    folds.push({
      body: summaryMatch
        ? inner.slice(summaryMatch.index + summaryMatch[0].length).trim()
        : inner.trim(),
      summary: summaryMatch ? summaryMatch[1]! : '',
    })
    match = re.exec(body)
  }
  return folds
}

/**
 * Every way the body's folds read like the pre-rewrite shape, in plain
 * sentences. Empty means nothing smelled. ADVISORY — see the file header.
 */
export function prBodySmells(body: string): PrBodySmell[] {
  const smells: PrBodySmell[] = []
  const folds = prBodyFolds(body)
  for (let i = 0, { length } = folds; i < length; i += 1) {
    const fold = folds[i]!
    const summaryText = summaryPlainText(fold.summary)
    const where = summaryText || `fold ${i + 1}`
    if (isGenericSummary(fold.summary)) {
      smells.push({
        detail:
          'the summary names a topic, so the reader must expand it to learn anything - use a short bold noun phrase, a spaced plain dash, then the specific claim',
        rule: 'informative-summary',
        where,
      })
    }
    const opener = firstContentLine(fold.body)
    if (opener && NOT_A_TAKEAWAY_RE.test(opener)) {
      smells.push({
        detail:
          'the fold opens on raw material (a list, table row, code fence, or heading) — state the takeaway first, then support it',
        rule: 'takeaway-first',
        where,
      })
    }
    const runs = parallelItemRuns(fold.body)
    for (let j = 0, runCount = runs.length; j < runCount; j += 1) {
      const run = runs[j]!
      const shape = parallelItemShape(run[0]!)
      if (
        run.length >= MIN_PARALLEL_ITEMS &&
        shape !== 'prose' &&
        run.every(item => parallelItemShape(item) === shape)
      ) {
        smells.push({
          detail: `${run.length} parallel items share a ${shape} lead — a two-column table is scannable and gives each row its own caveat`,
          rule: 'table-over-parallel-items',
          where,
        })
      }
    }
    if (STATUS_SUMMARY_RE.test(summaryText)) {
      const blocks = proseBlocks(fold.body)
      const labeled = blocks.filter(block =>
        LEAD_BOLD_RE.test(firstContentLine(block)),
      )
      if (
        blocks.length >= MIN_STATUS_BLOCKS &&
        labeled.length < MIN_STATUS_LABELS
      ) {
        smells.push({
          detail:
            'a status fold of same-looking paragraphs — label the lines (**Ran** / **Did not run** / **Trade-off** / **CI is unaffected**) so a reviewer finds the answer instantly',
          rule: 'labeled-status-lines',
          where,
        })
      }
    }
  }
  return smells
}

/**
 * The blank-line-separated blocks of `text` that are prose — code fences,
 * tables, and standalone lists are dropped, since only prose blocks can carry
 * a label.
 */
export function proseBlocks(text: string): string[] {
  const blocks: string[] = []
  const raw = text.split(/\n\s*\n/)
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const block = raw[i]!.trim()
    if (!block) {
      continue
    }
    const lead = firstContentLine(block)
    if (FENCE_RE.test(lead) || NOT_A_TAKEAWAY_RE.test(lead)) {
      continue
    }
    blocks.push(block)
  }
  return blocks
}

/**
 * The claim after a summary's separator, or an empty string when the summary
 * has none.
 */
export function summaryClaim(text: string): string {
  const match = CLAIM_SEPARATOR_RE.exec(text)
  return match ? text.slice(match.index + match[0].length).trim() : ''
}

/**
 * A summary's readable text: tags, emphasis markers, and code ticks stripped,
 * whitespace collapsed.
 */
export function summaryPlainText(summary: string): string {
  return summary
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
