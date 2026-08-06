#!/usr/bin/env node
// Claude Code PreToolUse + Stop hook — anti-prose-guard.
//
// The fleet's one BLOCKING prose guard, across both surfaces prose lands on.
//
// PreToolUse (Write/Edit): blocks a write to a human-facing prose surface
// (CHANGELOG.md, docs/**/*.md, README.md) whose content carries an AI-writing
// antipattern — throat-clearing openers, "not X, it's Y" contrasts, any
// em-dash, vague hedging adverbs. The fleet rule (CLAUDE.md "Prose authoring",
// .claude/skills/fleet/prose/SKILL.md): run human-facing prose through the
// prose skill before it lands. This is the hard gate — it supersedes the old
// prose-antipattern-nudge Stop hook (a reminder fires after the write and
// is ignorable; a PreToolUse block stops the bad prose from landing at all).
//
// Stop (the chat reply): blocks turn-end on the CATEGORICAL tier only
// (patterns.mts `CATEGORICAL_PROSE_BANS`, today the honesty family). The
// heuristics stay off the reply — they over-fire, and reply-prose-nudge
// already whispers about them. A categorical match is different in kind: the
// word itself is the defect, so the same law that gates a doc write gates the
// reply. The AI-lingo doctrine is ONE guard, never one guard per banned word —
// a new categorical ban joins `CATEGORICAL_PROSE_BANS` and inherits both
// surfaces for free.
//
// Bypass: `Allow prose-antipattern bypass` typed verbatim in a recent user
// turn — doc writes only. The reply has no bypass; rewrite the sentence.

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  findCategoricalProseBanHits,
  findChangelogImplDetail,
  findProseAntipatterns,
} from './patterns.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import type { GuardCheck, GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  bypassPhrasePresent,
  readLastAssistantTurnText,
  stripCodeFences,
} from '../_shared/transcript.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'

const BYPASS_PHRASE = 'Allow prose-antipattern bypass'
const CHANGELOG_IMPL_BYPASS_PHRASE = 'Allow changelog-impl-detail bypass'

// Prose surfaces the guard covers, matched against the normalized (forward-
// slash) path. CHANGELOG.md and README.md at any depth; any markdown under a
// `docs/` directory.
const CHANGELOG_RE = /(?:^|\/)CHANGELOG\.md$/
const README_RE = /(?:^|\/)README\.md$/
const DOCS_MD_RE = /(?:^|\/)docs\/.+\.md$/

// Enforcement-defining trees are use-vs-mention exempt: a hook/rule README
// that DOCUMENTS a banned pattern must be able to name it (the honesty
// guard's own README cannot avoid its hook name). Same shape as the
// authorization-phrase guard's phrase-defining-tree exemption. Plain
// segment checks on the ALREADY-normalized path — no separator regex.
const ENFORCEMENT_TREES = [
  '.claude/hooks/',
  '.config/fleet/oxlint-plugin/',
] as const

const ENFORCEMENT_CATALOG = 'docs/agents.md/fleet/hook-registry.md'

function isEnforcementSurface(rawPath: string): boolean {
  const unixPath = normalizePath(rawPath)
  for (let i = 0, { length } = ENFORCEMENT_TREES; i < length; i += 1) {
    const tree = ENFORCEMENT_TREES[i]!
    if (unixPath.startsWith(tree) || unixPath.includes(`/${tree}`)) {
      return true
    }
  }
  return (
    unixPath === ENFORCEMENT_CATALOG ||
    unixPath.endsWith(`/${ENFORCEMENT_CATALOG}`)
  )
}

function isProseSurface(normalizedPath: string): boolean {
  if (isEnforcementSurface(normalizedPath)) {
    return false
  }
  return (
    CHANGELOG_RE.test(normalizedPath) ||
    README_RE.test(normalizedPath) ||
    DOCS_MD_RE.test(normalizedPath)
  )
}

/**
 * The PreToolUse doc-write verdict: CHANGELOG implementation detail first,
 * then the full prose-antipattern table. The CHANGELOG rule is checked first
 * because the more specific guidance wins — a writer told only "no
 * implementation detail" knows what to do next, where the generic table entry
 * would leave them guessing which of its rows applied.
 */
export function findProseWriteVerdict(
  filePath: string,
  content: string | undefined,
  payload: ToolCallPayload,
): GuardResult {
  if (content === undefined) {
    return undefined
  }
  const normalized = normalizePath(filePath)
  if (!isProseSurface(normalized)) {
    return undefined
  }
  const rel = path.basename(filePath)

  // CHANGELOG-only: reject implementation detail (dep bumps, internal
  // mechanism names, "resolved by upgrading X"). A changelog states
  // user-visible behavior, not how it was delivered. Runs before the
  // general prose check so the more specific guidance wins.
  if (CHANGELOG_RE.test(normalized)) {
    const implHits = findChangelogImplDetail(content)
    if (
      implHits.length &&
      !bypassPhrasePresent(
        payload.transcript_path,
        CHANGELOG_IMPL_BYPASS_PHRASE,
      )
    ) {
      const evidence = implHits
        .map(hit => `${hit.label} "${hit.match}"`)
        .join('; ')
      return block(
        verdictLine(
          'block',
          'anti-prose-guard',
          `blocked ${rel} — implementation detail: ${evidence} — state the user-visible change instead (bypass response "${CHANGELOG_IMPL_BYPASS_PHRASE}")`,
        ),
      )
    }
  }

  const hits = findProseAntipatterns(content)
  if (!hits.length) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  const evidence = hits.map(hit => `${hit.label} "${hit.match}"`).join('; ')
  // Each pattern carries the replacement to write; without it the verdict says
  // a span is banned and leaves the author guessing. Sibling hooks (stop-nudge,
  // outbound-voice) already render theirs, so the shape matches. A row with no
  // `why` contributes no line rather than an empty one.
  const lines = [
    verdictLine(
      'block',
      'anti-prose-guard',
      `blocked ${rel} — ${evidence} — rewrite the flagged span(s), then retry (bypass response "${BYPASS_PHRASE}")`,
    ),
  ]
  const seen = new Set<string>()
  for (const hit of hits) {
    if (hit.why && !seen.has(hit.why)) {
      seen.add(hit.why)
      lines.push(verdictContinuation(hit.why))
    }
  }
  return block(lines.join('\n'))
}

// `fleetOnly` replaces the spec-level `scope: 'convention'`: it gates the
// DOC-WRITE path on the edited file living in a fleet-managed repo, exactly as
// the spec-level scope did, while leaving the Stop path unscoped. A chat reply
// has no file to judge, and the banned framing is just as wrong in a foreign
// checkout — the standalone guard this absorbed fired everywhere, and folding
// it in must not quietly shrink that reach to fleet repos only.
export const checkDocWrite = editGuard(findProseWriteVerdict, {
  fleetOnly: true,
})

/**
 * The Stop verdict: the categorical bans, scanned against the last assistant
 * turn with code fences stripped so a banned token QUOTED in a fence (this
 * hook's own README, a matcher source, a post-mortem) never fires.
 */
export function findReplyProseVerdict(payload: ToolCallPayload): GuardResult {
  const rawText = readLastAssistantTurnText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const hits = findCategoricalProseBanHits(stripCodeFences(rawText))
  if (!hits.length) {
    return undefined
  }
  // Terse on purpose: the human already saw the draft, and the harness
  // renders this verdict twice — the quoted word IS the whole instruction,
  // one line per hit, no label, no lecture (doctrine stays on the edit-time
  // surfaces).
  const lines: string[] = []
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    const body = `delete "${hit.matched}" — …${hit.snippet}…`
    lines.push(
      i === 0
        ? verdictLine('block', 'anti-prose-guard', body)
        : verdictContinuation(body),
    )
  }
  // Blocks even mid-retry of another Stop guard. Degrading to a notice there
  // opened a real hole: a reply rewritten to satisfy a DIFFERENT guard can
  // introduce the banned framing, and on that retry this one only whispered,
  // so the word shipped. The two-guards-deadlock worry does not apply, because
  // deleting a word always satisfies this guard — it can never demand what
  // another guard forbids. Nothing here reads `stop_hook_active`, which is how
  // the verdict survives the retry.
  return block(lines.join('\n'))
}

// One check, two payload shapes — the generator points both event rows at it.
// A Stop payload carries no `tool_name`; every tool call does.
export const check: GuardCheck = payload =>
  payload?.tool_name === undefined
    ? findReplyProseVerdict(payload)
    : checkDocWrite(payload)

export const hook = defineHook({
  bypass: ['prose-antipattern', 'changelog-impl-detail'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: ['PreToolUse', 'Stop'],
  // MACHINE-WIDE. The Stop path judges the REPLY, which has no repo — a banned
  // word is just as wrong answering from a foreign checkout, and that is what
  // the `fleetOnly: true` on `checkDocWrite` (rather than a spec-level
  // `scope: 'convention'`) was for: scope the file surface, leave the reply
  // surface universal. That intent shipped unrealized. Without this flag the
  // hook is only wired into repos carrying a cascaded `.claude/settings.json`,
  // so every session in a non-fleet repo ran with the fleet's ONLY blocking
  // prose guard absent — the honesty ban had zero coverage there, because the
  // one globally-wired reply hook (`reply-prose-nudge`) does not carry the
  // categorical tier. Enforced by
  // `scripts/fleet/check/categorical-prose-bans-are-live.mts`.
  global: true,
  // No `matcher`: a Stop payload has no tool, and a tool-filtered entry is
  // skipped outright for a tool-less payload (`hookHandlesTool`), which would
  // silently unwire the Stop surface. `editGuard` already returns undefined for
  // any non-edit tool, so the PreToolUse path costs one comparison.
  type: 'guard',
})

void runHook(hook, import.meta.url)
