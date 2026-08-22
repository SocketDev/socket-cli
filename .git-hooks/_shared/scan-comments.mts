// PR-process / quest / step-N narrative comment scanner (HARD block). Blocks
// point-in-time PR-process references from landing in SOURCE-CODE COMMENTS —
// process belongs in the PR description and git history, not the source. Also
// carries the comment-text extractor the scan depends on. Gate-free string
// logic built on scan-core.

import { lineIsSuppressed, splitLines } from './scan-core.mts'

import type { LineHit } from './scan-core.mts'

// ── PR-process / quest / step-N narrative comment scanner (HARD block) ──
//
// Blocks point-in-time PR-process references from landing in SOURCE-CODE
// COMMENTS. The motivating defect: sub-agents wrote `//! Step 4 of the net
// perf quest (#5419) …` and `// Step 2 ([#5638]) replaced the per-read Vec …`
// into shipping source. These references are meaningless once the PR merges
// (no reader of the file can resolve "step 4" or the PR thread), and they
// leak internal process into PUBLIC repos. A comment must read as TIMELESS
// design rationale — the WHY of the code as it stands — not a changelog of how
// it got here. Process belongs in the PR description and git history, not the
// source.
//
// SCOPE — comment text only. The scanner extracts the comment PORTION of each
// line (`//`, `//!`, `/* … */`, JSDoc ` * `, `#`, `<!-- … -->`) and matches
// the narrative patterns against that text alone, so a process word inside a
// string literal or identifier (`stepCount`, `phaseShift`, a GraphQL body)
// never trips it. Code is unaffected; only what a human wrote as prose.
//
// PATTERNS — two confidence tiers, CALIBRATED AGAINST THE FULL COMMITTED SOURCE
// OF TWO REAL REPOS (a fleet-wide pre-commit block must not false-positive on a
// legitimate existing comment). The QUEST idiom is the real discriminator and
// the only shape that fired on zero legit lines; the `step N` and issue-ref arms
// are narrowed to clear ~140 real false positives while still catching every
// motivating defect.
//
//   Tier-1 — confident, block-on-sight process-narrative shapes:
//     • `step <N>` on either of two genuine signals: (A) a bounded PAST-TENSE
//       CHANGE-VERB (or the explicit `replaces`/`reuses`) directly after the
//       ordinal (`step 2 replaced/switched/rewrote …`, tolerating an interposed
//       PR-ref `Step 2 ([#5638]) replaced …`); or (B) `step N of [the] <STRICT
//       effort noun>` — a step OF a named internal quest (`step 4 of the
//       quest`). DELIBERATELY NOT Tier-1 (real source + ordinary algorithm prose
//       use all of these for TIMELESS runbooks): a bare `^Step N`, a `Step N —`
//       dash heading, `step N of <STABLE procedure>` (`step 1 of the migration`,
//       `step 1 of every publish attempt` — construct/stable nouns, not the
//       strict jargon set), a bare imperative `step N add/move/drop …`, and a
//       pronoun-displaced `step N we added …`. The verb list is bounded
//       inflections, NOT `\w*` stems (so `address`/`folder`/`changeset` never
//       match). The cost is a tolerated false negative on a pronoun-rephrased
//       defect — accepted (a fleet-wide block must favor a recoverable miss over
//       a false positive that blocks an unrelated commit).
//     • `quest` (+ the QUALIFIED effort-noun set) as the process idiom — `perf
//       quest`, `the perf rework`, `net cleanup`, or `quest (#N)`. The bare noun
//       "quest", `the <any-word> quest` (a "quests" table, a game's quest log,
//       `the side quest`), and an UNqualified `the rework`/`optimization pass`
//       are NOT Tier-1 — legitimate domain words. The construct-colliding nouns
//       (`rework`/`cleanup`/`pass`/`migration`) block ONLY when perf/net/opt-
//       qualified. "question" / "requested" / "conquest" never match.
//     • GitHub-PR-process SYNTAX only — `resolves / closes / fixes #N`,
//       `follow-up to #N`, `reverts #N`, `cherry-picked #N`, and the verb-framed
//       `(added|fixed|resolved|introduced|landed|shipped|merged) in #N` (literal
//       `#` required). The bare parenthesised/bracketed `(#N)` / `[#N]` and bare
//       `PR #N` / `see PR #N` are NOT Tier-1 — real source proves those are
//       ENUMERATION ordinals (`devEngines.runtime (#1)`), UPSTREAM provenance
//       (`Flag added in Node 9.6.0 (#14253)`, `(PR #57038)`), and legitimate
//       regression-guard / tracking cross-refs (`Regression guard … on PR #36`).
//       The motivating `(#5419)` / `([#5638])` still block via QUEST_RE /
//       STEP_SEQ_RE, which do not rely on the bracketed-ref arm.
//
//   Tier-2 — a LONE `#<N>` mention in a comment (`// see #123`). A single
//   bare cross-ref is sometimes legitimate (citing a tracking issue for a
//   workaround's rationale). It is blocked ONLY when it CO-OCCURS on the same
//   line with a STRONG, unambiguous process word — `follow-up`, `merged`,
//   `landed`, `shipped`, `revert`, `rebase`, `squash`, `cherry-pick`. The set
//   deliberately EXCLUDES `commit` / `part` / `phase` / `step` / `PR`, which
//   collide with ordinary prose alongside a coincidental `#N` ("commit #200 of
//   the batch", "part 3 of the header"). And an UPSTREAM-Node citation (a `#N`
//   on a line carrying a Node-provenance shape — `Node <ver>`, `nodejs/node`, or
//   a two-digit `NN.x` Node release line — `#51575 … Landed on the 22.x line`)
//   is exempted: it is provenance, not nub's PR history. The shape is Node-
//   SPECIFIC, NOT a bare "node" mention, so a nub-internal `merged #88 into the
//   node-resolver` still blocks.
//
// FALSE-POSITIVE MITIGATIONS, beyond comment-only scoping:
//   • `shouldSkipFile` already exempts tests / fixtures / `.git-hooks/` — those
//     files legitimately quote these shapes (this scanner's OWN tests do).
//   • SPDX / license / copyright header lines are exempt (they carry years and
//     boilerplate that can look like a `part N` / bare-`#` co-occurrence).
//   • `phase`/`part <N>` are NOT bare-ordinal triggers — too common as plain
//     words; they reach a block only via the Tier-2 co-occurrence path.
//   • A standalone version / date token (`v2.3.1`, `2026-06-24`, `as of
//     2026-…`, `fixed in 26`) is not a PR number — the verb-framed issue-ref
//     arms require a LITERAL `#`, so a bare number/date never matches.
//   • Per-line opt-out: `// oxlint-disable-next-line socket/no-pr-process-comment` (or the `#`
//     form for shell/YAML) — the rare legitimate process reference. Default is
//     BLOCK.
//
// Rewrite guidance the hook prints: state the design rationale timelessly —
// "a process-wide freelist amortizes per-read allocation" — not the history —
// "step 4 of the perf quest added a freelist".

// Extract the comment text of a single line, or '' when the line has no
// comment. `block` carries whether the previous line left an unterminated
// `/* … */` open, so a no-leading-`*` block body is still scanned — the leak
// is just as real inside a C-style block as in a `//!` doc. Returns the
// comment text plus the block state to thread into the next line.
//
// Conservative + cheap, no full tokenizer — we only need the prose a human
// wrote, and must not mistake a `//` / `<!--` inside a string for a comment
// opener:
//   • Inside an open block the WHOLE line is comment text up to `*/`, which
//     clears the block state.
//   • A WHOLE-LINE comment — `//…`, `///…`, Rust doc, `*…` (JSDoc
//     continuation), `/*…`, `#…` (not `#!` shebang), `<!--…` — returns its
//     text after the opener; a `/*` with no `*/` OPENS a block.
//   • A TRAILING `//` or `<!--` on a code line returns the text after the
//     opener only when the opener sits outside a quote span (`'http://x'`,
//     `"#tag"` are not comments). A trailing `#` is NEVER a comment on a
//     code line — too overloaded (CSS colors, fragment URLs, shell `$#`) to
//     split mid-line safely; a WHOLE-LINE `#` heading is still caught.
const COMMENT_OPENER_WHOLE_RE = /^\s*(?:#(?!!)|<!--|\*|\/\*\*?|\/\/+!?)\s?/
export function commentTextOf(
  line: string,
  { block }: { block: boolean },
): { comment: string; block: boolean } {
  if (block) {
    // Inside an open `/* … */` — the whole line (to any `*/`) is prose.
    const end = line.indexOf('*/')
    if (end >= 0) {
      return { comment: line.slice(0, end), block: false }
    }
    return { comment: line.replace(/^\s*\*?\s?/, ''), block: true }
  }
  const whole = COMMENT_OPENER_WHOLE_RE.exec(line)
  if (whole) {
    const opensBlock = /\/\*/.test(line) && !line.includes('*/')
    const comment = line
      .slice(whole.index + whole[0].length)
      .replace(/\s*(?:-->|\*\/)\s*$/, '')
    return { comment, block: opensBlock }
  }
  // Trailing `//` or `<!--` on a code line — only when outside a quote span.
  for (const opener of ['//', '<!--'] as const) {
    let from = 0
    for (;;) {
      const at = line.indexOf(opener, from)
      if (at < 0) {
        break
      }
      if (!indexInsideQuote(line, at)) {
        return {
          comment: line
            .slice(at + opener.length)
            .replace(/\s*-->\s*$/, '')
            .trim(),
          block: false,
        }
      }
      from = at + opener.length
    }
  }
  // A `/*` opened mid-code-line, a trailing block comment — its body IS prose
  // and must be scanned (`code(); /* step 4 of … */` is just as much a leak as
  // a leading one). Slice from after the `/*`; if a `*/` closes it on the same
  // line, that bounds the comment, else the block stays open for the next line.
  const blockAt = line.indexOf('/*')
  if (blockAt >= 0 && !indexInsideQuote(line, blockAt)) {
    const bodyStart = blockAt + 2
    const closeAt = line.indexOf('*/', bodyStart)
    if (closeAt >= 0) {
      return { comment: line.slice(bodyStart, closeAt).trim(), block: false }
    }
    return { comment: line.slice(bodyStart).trim(), block: true }
  }
  return { comment: '', block: false }
}

// True when byte offset `at` falls inside a '…' / "…" / `…` quote span earlier
// on the same line. Used to reject a `//` that is really part of a URL or a
// string ("http://", "a // b" in a template). Single-line scan; comments span
// at most one physical line for our purposes.
function indexInsideQuote(line: string, at: number): boolean {
  let quote: string | undefined
  for (let i = 0; i < at; i++) {
    const ch = line[i]!
    if (quote) {
      if (ch === quote) {
        quote = undefined
      } else if (ch === '\\') {
        i++
      }
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    }
  }
  return quote !== undefined
}

// SPDX / license / copyright boilerplate — exempt from the process-narrative
// scan. These header lines carry years and standardized phrasing that can
// resemble a `part N` / bare-`#` co-occurrence, and they are never the leak
// this guard targets.
const LICENSE_HEADER_RE =
  /\b(?:Copyright\b|Licensed under|SPDX-License-Identifier|\(c\)\s*\d{4})\b/i

// Tier-1 — confident, block-on-sight process-narrative shapes.
//
// A named CHANGE EFFORT — the noun a process narrative is "step N OF". TWO tiers
// (a fleet-wide HARD block biases toward a false NEGATIVE — a missed rephrased
// defect, recoverable in review — over a false POSITIVE that blocks an unrelated
// commit; the noun sets are kept TIGHT for that reason):
//   STRICT — pure PR-process jargon with NO software-construct meaning, usable
//     BARE in the `step N of …` arm. EXCLUDES `pass` / `migration` / `cleanup` /
//     `rework` / `refactor` — those name real code constructs (a render/GC/
//     optimization PASS, a schema MIGRATION, the auth REFACTOR) and a legit
//     algorithm step is genuinely a "step N of the migration".
//   QUALIFIED — the strict set PLUS the construct-colliding words, matched ONLY
//     when a `perf`/`net`/`opt` adjective precedes (the QUEST_RE idiom): `the
//     perf rework` / `net cleanup` is unambiguous process narrative, while bare
//     `the rework` / `the cleanup` / `optimization pass` is not.
const EFFORT_NOUN = '(?:quest|crusade|odyssey)'
const EFFORT_NOUN_QUALIFIED =
  '(?:quest|crusade|odyssey|rework|refactor|effort|cleanup|sprint|overhaul)'

// `step <N>` is the headline shape (`//! Step 4 of the net perf quest`, `# …
// given step 2 already reuses …`). Matches ONLY on two signals, both absent
// from the legit procedural steps real source proves benign:
//   (A) `step N <CHANGE-VERB>` — a past-tense change-verb (or `replaces`/
//       `reuses`) DIRECTLY after the ordinal, tolerating an interposed
//       bracket-ref (`Step 2 ([#5638]) replaced …`). The verb list is bounded
//       to real inflections, not open `\w*` stems, and excludes the bare
//       imperative (`add`/`move`/`drop`), which is ordinary algorithm prose.
//   (B) `step N of [the] <STRICT effort noun>` — a step OF a named internal
//       quest (`step 4 of the quest`). `step 1 of the migration` uses a
//       construct/stable noun, not the strict jargon set, so it passes.
//
// Deliberately NOT matched (calibrated against two real repos' full history,
// to avoid a fleet-wide false positive): a bare `^Step N` heading, `step N of
// <STABLE procedure>`, a bare imperative `step N <verb>`, and a
// pronoun-displaced `step N we <verb>` (falls through to Tier-2). The
// accepted cost is a tolerated false NEGATIVE on a pronoun-rephrased defect —
// QUEST_RE still catches the `… perf <effort>` framing.
const STEP_VERB =
  '(?:replaced|replaces|reused|reuses|added|introduced|removed|changed|landed|switched|rewrote|refactored|moved|dropped|converted|eliminated|reworked|became|already)'
const STEP_SEQ_RE = new RegExp(
  `\\bstep\\s+\\d+(?:\\s*[([]+#\\d+[)\\]]+)?\\s+${STEP_VERB}\\b` +
    `|\\bstep\\s+\\d+\\s+of\\s+(?:the\\s+)?(?:[\\w-]+\\s+){0,2}${EFFORT_NOUN}\\b`,
  'i',
)

// `quest`, and its qualified effort-noun siblings, means PR-process only in the
// idiom "<perf/net/opt> <effort-noun>" — the bare noun is a legitimate domain
// word (a "quests" table, a game's quest log, `the side quest`). Require the
// process qualifier (`perf rework`, `the net effort`) or an adjacent issue ref;
// a bare `\bquest\b` or `the <any-word> quest` is too broad (it would block `the
// daily quest reward system`).
const QUEST_RE = new RegExp(
  `\\b(?:\\w+\\s+)?(?:perf|performance|net|opt(?:imization)?)\\s+${EFFORT_NOUN_QUALIFIED}\\b` +
    `|\\bquest\\b\\s*\\(?#?\\d` +
    `|\\bthe\\s+(?:perf|performance|net|opt(?:imization)?)\\s+${EFFORT_NOUN_QUALIFIED}\\b`,
  'i',
)

// `phase`/`part <N>` are common ordinary words ("phase shift", "for the most
// part", "part 1 of the header"), so they are NOT bare-ordinal Tier-1. They
// reach a block only via the Tier-2 co-occurrence path (a `#N` or a strong
// process verb on the same line). Kept as a named constant for the word set.

// Tier-1 process-framed PR/issue cross-references. Keeps ONLY the unambiguous
// GitHub-PR-process SYNTAX — shapes that never appear in timeless rationale
// (verified: zero false positives across two real repos' committed source):
//   • GitHub closing keywords `resolves / closes / fixes #N` (pure PR boilerplate).
//   • process verbs `follow-up to #N`, `reverts #N`, `cherry-picked #N`.
//   • verb-framed `(added|fixed|resolved|introduced|landed|shipped|merged) in #N`,
//     now requiring the LITERAL `#` (the old optional `#?` matched bare
//     dates/versions — `fixed in 26`, `resolved in 14.15.1`, `as of 2026-…`).
//     `as of` is dropped from the verb list entirely, a data-currency stamp.
//
// DELIBERATELY DROPPED from Tier-1 (now block only via the Tier-2 co-occurrence
// path): the bare parenthesised/bracketed `(#N)` / `[#N]` and the bare `PR #N`
// arms. Real source proves those are enumeration ordinals, upstream provenance
// citations (`Flag added in Node 9.6.0 (#14253)`), and legitimate
// regression-guard cross-refs. The motivating defects still block via QUEST_RE
// (`Step 4 of the net perf quest (#5419)`) and STEP_SEQ_RE (`Step 2 ([#5638])
// replaced …`) — neither relies on the bracketed-ref arm.
// Exported so the docs-surface gate (check/pr-refs-in-docs-are-linked.mts)
// reuses the SAME ref shape a commit-comment carries — one source, no drift.
export const PROCESS_ISSUE_REF_RE =
  /\b(?:closes|fixes|resolves)\s+#\d+\b|\b(?:cherry[- ]?picked|follow[- ]?up to|reverts?)\s+#\d+\b|\b(?:added|fixed|introduced|landed|merged|resolved|shipped)\s+in\s+#\d+\b/i

// Tier-2: a lone `#<N>` mention blocks ONLY when a STRONG, unambiguous process
// word co-occurs on the same line. The word set is deliberately narrow — it
// excludes `commit` / `part` / `phase` / `step` / `PR`, which collide with
// ordinary prose ("commit #200 of the batch", "part 3 of the header", a `#N`
// count) — keeping only verbs that are overwhelmingly git/PR-process:
// merged / landed / shipped / revert / rebase / squash / cherry-pick /
// follow-up, plus the perf-qualified `quest`.
// Exported for the docs-surface gate; see PROCESS_ISSUE_REF_RE above.
export const LONE_ISSUE_REF_RE = /#\d+\b/
// Match git/PR process verbs: follow-up, merged, landed, shipped, reverts,
// rebased, squashed, cherry-picked — the words that signal a commit message
// is talking about its own change history rather than general prose.
// Exported for the docs-surface gate (pr-refs-in-docs-are-linked.mts), which
// reuses this Tier-2 co-occurrence so a lone `#N` flags there only when it flags
// here — an ordinal like "the #10 tell" carries no process verb and is left be.
export const PROCESS_WORD_RE =
  /\b(?:cherry[- ]?pick(?:ed)?|follow[- ]?up|landed|merged|rebase[ds]?|reverts?|shipped|squash(?:ed)?)\b/i

// Upstream-provenance exemption for the Tier-2 lone-`#N` path: a `#N` whose line
// cites an UPSTREAM Node fact is timeless evidence, not nub's own PR
// change-history. The motivating real case: `#51575 ("add EventSource
// Client"). Landed on the 22.x line at 22.3.0` (a Node issue + the Node release
// line it landed on). Scoped to Tier-2 ONLY (the lone-`#N` path); the Tier-1
// GitHub-keyword shapes (`resolves #N`, `landed in #N`) are PR-process syntax
// regardless of any version mention.
//
// SHAPE-based + Node-SPECIFIC — NOT a bare `\bnode\b` (this is a Node tool;
// "node" appears in most nub-internal comments, so a bare match would exempt
// genuine process lines like `merged #88 into the node-resolver rewrite`). The
// release-line arm requires a TWO-digit `\d\d.x` — Node's line is 18–26, so
// `22.x` matches but a single-digit `2.x` (nub's own / another tool's release
// line — `shipped #5 on the 2.x branch`) does NOT, and still blocks.
// Exported for the docs-surface gate; see PROCESS_ISSUE_REF_RE above.
export const UPSTREAM_CONTEXT_RE =
  /\bnode\s+v?\d+\.\d+|\bnodejs\/node\b|\b\d\d\.x\b/i

// Returns the comment lines that carry a PR-process / quest / step-N
// narrative. One hit per offending line; the `line` field is the raw source
// line (for the file:line report), matched against its extracted comment text.
export const scanPrProcessComments = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = splitLines(text)
  let block = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const extracted = commentTextOf(line, { block })
    block = extracted.block
    const comment = extracted.comment.trim()
    if (!comment) {
      continue
    }
    // Per-line opt-out + license/header exemption.
    if (
      lineIsSuppressed(line, 'pr-process-comment') ||
      LICENSE_HEADER_RE.test(comment)
    ) {
      continue
    }
    const tier1 =
      STEP_SEQ_RE.test(comment) ||
      QUEST_RE.test(comment) ||
      PROCESS_ISSUE_REF_RE.test(comment)
    // Tier-2: a lone `#N` blocks ONLY alongside a strong process word — unless
    // the line is upstream-Node provenance (a `#N` + `Node`/`N.x` release-line
    // context), which is a citation, not nub's PR change-history.
    const tier2 =
      LONE_ISSUE_REF_RE.test(comment) &&
      PROCESS_WORD_RE.test(comment) &&
      !UPSTREAM_CONTEXT_RE.test(comment)
    if (tier1 || tier2) {
      hits.push({ lineNumber: i + 1, line })
    }
  }
  return hits
}
