#!/usr/bin/env node
// Claude Code Stop hook — excuse-detector.
//
// Scans the assistant's most recent turn for excuse-shaped phrases
// that violate CLAUDE.md's "No 'pre-existing' excuse" and "Fix > defer"
// rules.
//
// Runs in BLOCKING mode: when a match is found, the hook returns a
// `block()` verdict so the agent must continue the turn and address the
// matched phrase (e.g. fix the "pre-existing" TS errors) rather than
// ending the turn on the excuse. The block is suppressed when
// `stop_hook_active` is set, so this can fire at most once per stop
// chain — the agent is given one forced chance to fix or to state the
// trade-off explicitly; after that it degrades to a non-blocking
// `notify()`.

import {
  computeActorId,
  isActorLive,
  LEDGER_TTL_MS,
  listOtherActorLedgerPaths,
  readActorLedger,
  resolveStoreRoot,
} from '../_shared/active-edits-ledger.mts'
import { block, defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  formatReminderBlock,
  scanReminderText,
} from '../_shared/stop-nudge.mts'
import type { ReminderHit, RuleViolation } from '../_shared/stop-nudge.mts'
import {
  readLastAssistantText,
  stripCodeFences,
  stripQuotedSpans,
} from '../_shared/transcript.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

const NAME = 'excuse-detector'

const CLOSING_HINT =
  "These phrases usually precede a deferral. The Stop hook will block once so the agent must act on the matched item — either fix it now, or state the trade-off explicitly with the user's constraint."

// Deferral-verb fragment shared by every bare-phrase pattern that
// the assistant might quote descriptively in a summary. Phrases
// like "out of scope" or "unrelated to the task" appear in
// "rule docs describe X" prose just as often as in actual
// deferrals; pairing them with a co-located deferral verb in
// the regex eliminates the false positive at the cost of
// missing some legitimate excuses that don't say `skip` /
// `leave` / `defer` in the same sentence. Worth it: false
// positives erode trust in the hook faster than false negatives.
const DEFER = String.raw`(skip|skipping|skipped|leave|leaving|left|defer|deferring|deferred|ignore|ignoring|ignored|won't|wont|cannot|can't|cant|not (going|gonna) to (fix|address|touch))`

/**
 * Build a regex that fires when `phraseRe` appears within ~60 chars (either
 * side) of a deferral verb. Use for bare phrases whose surface form alone is
 * ambiguous (descriptive vs. deferral).
 */
export function withDeferralVerb(phraseRe: string): RegExp {
  return new RegExp(
    `${phraseRe}[^.?!\\n]{0,60}\\b${DEFER}\\b|\\b${DEFER}\\b[^.?!\\n]{0,60}${phraseRe}`,
    'i',
  )
}

const PATTERNS: readonly RuleViolation[] = [
  {
    label: 'pre-existing (deferral shape)',
    // Bare "pre-existing" matches both "this is pre-existing, skipping it"
    // (deferral) and "pre-existing test-fixture bugs were fixed"
    // (descriptive). Require a deferral verb in range.
    regex: withDeferralVerb(String.raw`\bpre[- ]?existing\b`),
    why: 'CLAUDE.md "No pre-existing excuse": if you see a lint error, type error, test failure, broken comment, or stale comment anywhere in your reading window — fix it. (Only fires when paired with a deferral verb in range.)',
  },
  {
    label: 'not related to my (deferral shape)',
    // Without a deferral verb in range this fires on descriptive
    // prose ("the fix is not related to my prior changes — it's
    // its own commit"). Require a verb.
    regex: withDeferralVerb(String.raw`\b(not |un)?related to my\b`),
    why: 'CLAUDE.md "Unrelated issues are critical": an unrelated bug is not a reason to defer — fix it immediately. (Only fires when paired with a deferral verb in range.)',
  },
  {
    label: 'unrelated to the task (deferral shape)',
    regex: withDeferralVerb(String.raw`\bunrelated to (the |this )?task\b`),
    why: 'CLAUDE.md "Unrelated issues are critical": same as above. (Only fires when paired with a deferral verb in range.)',
  },
  {
    label: 'out of scope (deferral shape)',
    // Common descriptive shape: "the rule's out-of-scope handling
    // is X". Require a deferral verb so we don't fire on docs.
    regex: withDeferralVerb(
      String.raw`\b(out of|outside)( (the|this))? scope\b`,
    ),
    why: 'CLAUDE.md "No pre-existing excuse": the only exceptions are genuinely large refactors (state the trade-off and ask). (Only fires when paired with a deferral verb in range.)',
  },
  {
    label: 'separate concern (deferral shape)',
    regex: withDeferralVerb(String.raw`\bseparate concern\b`),
    why: 'CLAUDE.md "Unrelated issues are critical": fix the unrelated bug first, in its own commit, then resume the original task. (Only fires when paired with a deferral verb in range.)',
  },
  {
    label: 'leave it for later',
    // Already deferral-shaped by construction ("leave" is the verb);
    // no extra DEFER pairing needed.
    regex: /\bleave (?:it|that|this) for later\b/i,
    why: 'CLAUDE.md "Completion": never leave TODO/FIXME/XXX/shims/stubs/placeholders — finish 100%.',
  },
  {
    label: 'not my issue',
    // Already deferral-shaped; "not my X" is the surface form of
    // the deferral itself.
    regex: /\bnot my (?:bug|issue|problem)\b/i,
    why: 'CLAUDE.md "Unrelated issues are critical": same as "unrelated".',
  },
  {
    label: 'which direction do you want',
    regex: /\bwhich direction do you want\b/i,
    why: 'CLAUDE.md "Fix > defer": don\'t offer fix-vs-defer as a binary choice. Pick the fix path and execute.',
  },
  {
    label: 'should I implement … or accept',
    regex:
      // "should I/we [fix-verb] … or [defer-verb]" — fix-vs-defer binary offered as a question.
      /\bshould (?:i|we) (?:build|do|fix|implement) [^.?!\n]+(?:,|or)\s+(?:accept|defer|document|leave|skip|treat)\b/i,
    why: 'CLAUDE.md "Fix > defer": this is a choice-architecture masquerading as a question. Fix it.',
  },
  {
    label: 'accept … as (a) (known )?gap',
    regex:
      // "accept [subject] as (a) (known|documented|expected) gap/drift/limitation" — gap-acceptance deferral.
      /\baccept (?:this|it|that|[^.?!\n]{1,40}) as (?:a |an )?(?:documented |expected |known )?(?:drift|gap|limitation)\b/i,
    why: 'CLAUDE.md "Fix > defer": gap-acceptance is the rationalization branch. The fix is the answer unless the user explicitly asked for the trade-off.',
  },
  {
    label: 'two paths/options: fix … or',
    regex:
      // "two/three choices/options/paths … fix … or [defer-verb]" — presenting a menu instead of picking fix.
      /\b(?:three|two) (?:choices|options|paths)[^.?!\n]{0,40}(?:fix|implement)[^.?!\n]{0,80}(?:,|or)\s+(?:accept|defer|document|leave|skip|treat)\b/i,
    why: 'CLAUDE.md "Fix > defer": collapsing the menu — pick the fix path, start the first sub-step.',
  },
  {
    label: 'document(ed)? (it )?as a known (gap|drift|limitation)',
    regex:
      // "document(ed) [something] as a known drift/gap/limitation" — deferral euphemism for not fixing.
      /\bdocument(?:ed)?\b[^.?!\n]{0,40}\bas a known (?:drift|gap|limitation)\b/i,
    why: 'CLAUDE.md "Fix > defer": "document as known gap" is the deferral euphemism. Fix it instead.',
  },
  {
    label: 'want me to fix … or',
    regex:
      // "want me to [fix-verb] … or [defer-verb]" — re-litigating the fix decision instead of executing.
      /\bwant me to (?:address|build|do|fix|implement) [^.?!\n]+(?:,|or)\s+(?:accept|defer|document|leave|move on|skip|treat)\b/i,
    why: 'CLAUDE.md "Fix > defer": same pattern — re-litigating the fix decision. The user already said yes by virtue of asking.',
  },
  {
    label: 'fix it … or leave it broken/stranded',
    // The "fix vs leave-broken" false binary. The other menu patterns
    // catch "fix … or accept/defer/document/skip"; this one targets the
    // bluntest framing — offering "leave it broken / stranded / unfixed"
    // as a co-equal option to fixing. When the real choice is fix-vs-
    // leave-broken, the answer is always fix.
    //
    // Anchored on BOTH a fix-verb AND an explicit "leave/let … broken"
    // option separated by "or"/comma. A bare adjective ("the build was
    // broken, I fixed it") must NOT fire — only the offered-as-a-choice
    // shape does, which is why there's no bare-adjective deferral pattern
    // here (that false-fires on descriptive prose like "left it broken;
    // fixed now").
    regex:
      // "[fix-verb] (it) … or (just) leave/let … broken/stranded/unfixed/…" — fix-vs-leave-broken false binary.
      /\b(?:correct|fix|repair)(?:\s+it)?\b[^.?!\n]{0,80}(?:,|\bor\b)\s*(?:just\s+)?(?:leave|let)\b[^.?!\n]{0,40}\b(?:as[- ]is|blocked|broken|failing|red|stranded|stuck|unfixed)\b/i,
    why: 'CLAUDE.md "Fix > defer" + "Never offer fix-vs-accept-as-gap as a choice": fix-vs-leave-broken is not a real choice. Pick the fix and execute. The only valid exception is a genuinely large refactor or off-machine action — state that trade-off explicitly, do not present "leave it broken" as a peer option.',
  },
]

// Relaying an unverified subagent/audit claim. A single regex over-fires on
// "the agent found 52, but grep showed 0" (verified relays), so this is a
// two-step sentence-scoped check: find the claim (agent/audit + report-verb +
// a number = a structural count), then confirm the SAME sentence carries no
// verification / correction verb. CLAUDE.md "Verify subagent claims": counts
// are leads, not facts.
export function relayedUnverifiedClaims(text: string): readonly ReminderHit[] {
  // (the) agent|audit|reviewer … found|flagged|reported … <digit>: structural count claim from an automated source.
  const CLAIM =
    /\b(?:the )?(?:(?:sub)?agent|audit|reviewer)\b[^.?!\n]{0,40}\b(?:claims?|flagged|found|identified|reported|says?)\b[^.?!\n]{0,30}\d/gi
  const VERIFIED =
    /\b(?:actually|but|checked|confirm|disprov|false|grep|however|re-deriv|spot-check|verif|wrong)\w*/i
  const hits: ReminderHit[] = []
  for (const m of text.matchAll(CLAIM)) {
    const rest = text.slice(m.index)
    const endRel = rest.search(/[.?!\n]/)
    const sentence = endRel === -1 ? rest : rest.slice(0, endRel)
    if (!VERIFIED.test(sentence)) {
      hits.push({
        label: 'relaying an unverified subagent claim (count)',
        why: 'CLAUDE.md "Verify subagent claims before relaying or acting": a subagent\'s counts / lists / behavior assertions are leads, not facts. grep/read the cited files and report only what you confirmed (plus an explicit disproved / unverified section). See docs/agents.md/fleet/agent-delegation.md.',
        snippet: sentence.length > 80 ? sentence.slice(0, 77) + '…' : sentence,
      })
    }
  }
  return hits
}

/**
 * True when at least one OTHER live actor's ledger is present in the active-
 * edits store. Used to gate the promissory-wait patterns — those patterns only
 * fire when a real concurrent run is present (so benign promises like "I'll
 * add tests next" never match).
 *
 * Fail-open: any IO / parse error returns false so the promissory patterns
 * never fire spuriously on a broken store.
 */
export function hasLiveForeignActor(
  transcriptPath: string | undefined,
  projectDir: string | undefined,
): boolean {
  const ownActorId = computeActorId(transcriptPath)
  if (!ownActorId || !projectDir) {
    return false
  }
  const storeRoot = resolveStoreRoot(projectDir)
  const otherPaths = listOtherActorLedgerPaths(storeRoot, ownActorId)
  const now = Date.now()
  for (let i = 0, { length } = otherPaths; i < length; i += 1) {
    const raw = readActorLedger(otherPaths[i]!)
    if (
      raw &&
      raw.actorId !== ownActorId &&
      isActorLive(raw, { now, ttlMs: LEDGER_TTL_MS })
    ) {
      return true
    }
  }
  return false
}

// Promissory-wait patterns — ledger-gated: only fire when a live foreign actor
// is present (hasLiveForeignActor check in promissoryWaitHits). These match the
// three real transcript sentences from the #239 incident:
//   "I'll watch the workflow to completion, then verify, build, and land"
//   "if it finishes or wedges"
//   "land whatever it leaves"
// Plus the general shape "I'll monitor/watch … until it finishes/completes".
//
// Each pattern is anchored to a live-run reference (workflow/run/agent/task)
// so benign forward-looking prose ("I'll add tests next") does not match.
const PROMISSORY_WAIT_PATTERNS: readonly RegExp[] = [
  // "watch/monitor … (to completion|when it finishes|until done)" — open-ended watch promise.
  /\b(?:i'?ll?\s+)?(?:monitor|watch)\b[^.?!\n]{0,80}\b(?:to completion|until (?:done|it (?:completes?|finishes|lands?))|when it (?:completes?|finishes|lands?))\b/i,
  // "wait and see" — passive deferral while a run is live.
  /\bwait and see\b/i,
  // "if it (finishes|wedges|lands|completes)" — conditional on a live run's outcome.
  /\bif it (?:completes?|fails?|finishes|hangs?|lands?|stalls?|wedges?)\b/i,
  // "land whatever it leaves" — inheriting a live run's output instead of acting.
  /\bland whatever it (?:drops?|leaves?|outputs?|produces?)\b/i,
  // "verify … once it (completes|finishes|lands)" — deferring verification to run completion.
  /\b(?:check|confirm|verify)\b[^.?!\n]{0,60}\bonce it (?:completes?|finishes?|lands?)\b/i,
  // "I'll watch/monitor … (the workflow/run/agent/task) … to completion" — generic.
  /\b(?:i'?ll?\s+)?(?:monitor|watch)\b[^.?!\n]{0,60}\b(?:agent|job|run|task|workflow)\b[^.?!\n]{0,60}\b(?:complete|finish|land|to completion)\b/i,
]

// Delegate-wait patterns — UNGATED (no ledger check): a parent ending its
// turn waiting on a spawned delegate parks forever no matter who else is
// live, because a delegate cannot SendMessage its parent (the parent is not
// an addressable agent; the child's message bounces and its report lands
// only in the orchestrator's notification stream). Each pattern is anchored
// to a delegate/subagent/child-agent reference so benign forward-looking
// prose never matches.
const DELEGATE_WAIT_PATTERNS: readonly RegExp[] = [
  // "waiting for the delegate's report/reply/result" — parked parent.
  /\b(?:park(?:ed|ing)?|wait(?:ing)?)\b[^.?!\n]{0,60}\b(?:child agent|delegate|sub-?agent)(?:'s)?\b[^.?!\n]{0,40}\b(?:message|repl(?:ies|y)|report|response|result)/i,
  // "when/once the subagent reports back / messages me" — report-back that never arrives.
  /\b(?:child agent|delegate|sub-?agent)\b[^.?!\n]{0,60}\b(?:messages? me|replies|reports? back|sends? (?:a |its )?(?:message|report))\b/i,
  // "once the delegate finishes/completes/returns, I'll …" — turn-end deferral to a child.
  /\b(?:after|once|when) (?:its |my |the )?(?:child agent|delegate|sub-?agent)\b[^.?!\n]{0,60}\b(?:complet|finish|repl|report|return)/i,
  // "awaiting/expecting a SendMessage" — the exact mechanism that bounces.
  /\b(?:await|expect)(?:ing)?\b[^.?!\n]{0,40}\bsendmessage\b/i,
]

/**
 * Scan text for delegate report-back waits. Ungated: these park the parent
 * in every context. The remedy is the report-back contract from
 * docs/agents.md/fleet/agent-delegation.md — foreground Agent calls return
 * the child's final text as the tool result; background delegates re-invoke
 * the spawner on completion; anything else means the parent polls the
 * delegate's output (or re-runs verification itself) before ending the turn.
 */
export function delegateWaitHits(text: string): readonly ReminderHit[] {
  const hits: ReminderHit[] = []
  for (let i = 0, { length } = DELEGATE_WAIT_PATTERNS; i < length; i += 1) {
    const re = DELEGATE_WAIT_PATTERNS[i]!
    const m = re.exec(text)
    if (m) {
      const snippet = m[0].length > 80 ? m[0].slice(0, 77) + '…' : m[0]
      hits.push({
        label: 'ending the turn on a delegate report-back',
        why: "A delegate cannot SendMessage its parent — the parent is not addressable and the message bounces. Report-back contract (docs/agents.md/fleet/agent-delegation.md): a foreground Agent call returns the child's final text as the tool result; a background delegate re-invokes you on completion; otherwise poll the delegate's output or re-run the verification yourself. Do that now instead of ending the turn waiting.",
        snippet,
      })
    }
  }
  return hits
}

/**
 * Scan text for promissory-wait phrases. Returns hits only when a live foreign
 * actor is confirmed in the ledger (gated). When no live actor is present,
 * returns an empty array so benign prose never fires.
 */
export function promissoryWaitHits(
  text: string,
  transcriptPath: string | undefined,
  projectDir: string | undefined,
): readonly ReminderHit[] {
  if (!hasLiveForeignActor(transcriptPath, projectDir)) {
    return []
  }
  const hits: ReminderHit[] = []
  for (let i = 0, { length } = PROMISSORY_WAIT_PATTERNS; i < length; i += 1) {
    const re = PROMISSORY_WAIT_PATTERNS[i]!
    const m = re.exec(text)
    if (m) {
      const snippet = m[0].length > 80 ? m[0].slice(0, 77) + '…' : m[0]
      hits.push({
        label: 'open-ended wait promise (live foreign actor present)',
        why: 'CLAUDE.md "Active-edits ledger": converge now instead of waiting — arm a Monitor, hand off via a .claude/plans/ doc, or use TaskStop to stop the live run. Never end a turn on an open-ended watch/wait promise while a concurrent run is live.',
        snippet,
      })
    }
  }
  return hits
}

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  const rawText = readLastAssistantText(payload?.transcript_path)
  if (!rawText) {
    return undefined
  }
  // Strip quoted spans so the hook doesn't self-fire when the
  // assistant *describes* the phrases it detects (e.g. a summary
  // saying "when Claude says 'pre-existing', the hook blocks").
  // Quoted phrases are *referenced* not *asserted*, so they should
  // not count as deferrals. Code-fence stripping is always on.
  const text = stripQuotedSpans(stripCodeFences(rawText))

  const projectDir = resolveProjectDir()
  const promissoryHits = promissoryWaitHits(
    text,
    payload?.transcript_path,
    projectDir,
  )
  const hits = await scanReminderText(text, PATTERNS, relayedUnverifiedClaims)
  const allHits = [...hits, ...promissoryHits, ...delegateWaitHits(text)]
  if (allHits.length === 0) {
    return undefined
  }

  const message = formatReminderBlock(NAME, allHits, CLOSING_HINT)

  // Blocking mode: return a block() verdict so the agent must continue the
  // turn and address the matched phrase. Suppressed when
  // `stop_hook_active` is already set, to avoid loops — that case degrades
  // to a non-blocking notice. `stop_hook_active` is a Stop-payload field
  // absent from ToolCallPayload's declared shape; narrow it defensively off
  // the raw payload.
  const stopHookActive =
    (payload as { stop_hook_active?: unknown | undefined }).stop_hook_active ===
    true
  if (stopHookActive) {
    return notify(message)
  }
  return block(
    message +
      '\nFix the underlying issue now (or, if it truly cannot be fixed in this session, ' +
      'say so explicitly with the trade-off — do not end the turn on the excuse phrase).',
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
