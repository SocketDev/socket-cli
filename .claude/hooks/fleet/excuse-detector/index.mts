#!/usr/bin/env node
// Claude Code Stop hook — excuse-detector.
//
// Scans the assistant's most recent turn for excuse-shaped phrases
// that violate CLAUDE.md's "No 'pre-existing' excuse" and "Fix > defer"
// rules.
//
// Runs in BLOCKING mode: when a match is found, the hook emits a
// Stop-hook block decision so Claude must continue the turn and
// address the matched phrase (e.g. fix the "pre-existing" TS errors)
// rather than ending the turn on the excuse. The block is suppressed
// when `stop_hook_active` is set, so this can fire at most once per
// stop chain — Claude is given one forced chance to fix or to state
// the trade-off explicitly.

import { runStopReminder } from '../_shared/stop-reminder.mts'

import type { ReminderHit } from '../_shared/stop-reminder.mts'

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

await runStopReminder({
  name: 'excuse-detector',
  blocking: true,
  // Strip quoted spans so the hook doesn't self-fire when the
  // assistant *describes* the phrases it detects (e.g. a summary
  // saying "when Claude says 'pre-existing', the hook blocks").
  // Quoted phrases are *referenced* not *asserted*, so they should
  // not count as deferrals.
  stripQuotedSpans: true,
  patterns: [
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
        /\bshould (?:i|we) (?:build|do|fix|implement) [^.?!\n]+(?:or|,)\s+(?:accept|defer|document|leave|skip|treat)\b/i,
      why: 'CLAUDE.md "Fix > defer": this is a choice-architecture masquerading as a question. Fix it.',
    },
    {
      label: 'accept … as (a) (known )?gap',
      regex:
        /\baccept (?:this|it|that|[^.?!\n]{1,40}) as (?:a |an )?(?:known |documented |expected )?(?:drift|gap|limitation)\b/i,
      why: 'CLAUDE.md "Fix > defer": gap-acceptance is the rationalization branch. The fix is the answer unless the user explicitly asked for the trade-off.',
    },
    {
      label: 'two paths/options: fix … or',
      regex:
        /\b(?:three|two) (?:choices|options|paths)[^.?!\n]{0,40}(?:fix|implement)[^.?!\n]{0,80}(?:or|,)\s+(?:accept|defer|document|leave|skip|treat)\b/i,
      why: 'CLAUDE.md "Fix > defer": collapsing the menu — pick the fix path, start the first sub-step.',
    },
    {
      label: 'document(ed)? (it )?as a known (gap|drift|limitation)',
      regex:
        /\bdocument(?:ed)?\b[^.?!\n]{0,40}\bas a known (?:drift|gap|limitation)\b/i,
      why: 'CLAUDE.md "Fix > defer": "document as known gap" is the deferral euphemism. Fix it instead.',
    },
    {
      label: 'want me to fix … or',
      regex:
        /\bwant me to (?:address|build|do|fix|implement) [^.?!\n]+(?:or|,)\s+(?:skip|defer|document|treat|accept|leave|move on)\b/i,
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
        /\b(?:fix|correct|repair)(?:\s+it)?\b[^.?!\n]{0,80}(?:\bor\b|,)\s*(?:just\s+)?(?:leave|let)\b[^.?!\n]{0,40}\b(?:broken|stranded|unfixed|as[- ]is|stuck|blocked|failing|red)\b/i,
      why: 'CLAUDE.md "Fix > defer" + "Never offer fix-vs-accept-as-gap as a choice": fix-vs-leave-broken is not a real choice. Pick the fix and execute. The only valid exception is a genuinely large refactor or off-machine action — state that trade-off explicitly, do not present "leave it broken" as a peer option.',
    },
  ],
  closingHint:
    "These phrases usually precede a deferral. The Stop hook will block once so Claude must act on the matched item — either fix it now, or state the trade-off explicitly with the user's constraint.",
  // Relaying an unverified subagent/audit claim. A single regex over-fires on
  // "the agent found 52, but grep showed 0" (verified relays), so this is a
  // two-step sentence-scoped check: find the claim (agent/audit + report-verb +
  // a number = a structural count), then confirm the SAME sentence carries no
  // verification / correction verb. CLAUDE.md "Verify subagent claims": counts
  // are leads, not facts.
  extraCheck: (text: string): readonly ReminderHit[] => {
    const CLAIM =
      /\b(?:the )?(?:(?:sub)?agent|audit|reviewer)\b[^.?!\n]{0,40}\b(?:found|flagged|identified|reported|says?|claims?)\b[^.?!\n]{0,30}\d/gi
    const VERIFIED =
      /\b(?:verif|grep|checked|confirm|spot-check|re-deriv|disprov|false|wrong|actually|but|however)\w*/i
    const hits: ReminderHit[] = []
    for (const m of text.matchAll(CLAIM)) {
      const rest = text.slice(m.index)
      const endRel = rest.search(/[.?!\n]/)
      const sentence = endRel === -1 ? rest : rest.slice(0, endRel)
      if (!VERIFIED.test(sentence)) {
        hits.push({
          label: 'relaying an unverified subagent claim (count)',
          why: 'CLAUDE.md "Verify subagent claims before relaying or acting": a subagent\'s counts / lists / behavior assertions are leads, not facts. grep/read the cited files and report only what you confirmed (plus an explicit disproved / unverified section). See docs/claude.md/fleet/agent-delegation.md.',
          snippet: sentence.length > 80 ? sentence.slice(0, 77) + '…' : sentence,
        })
      }
    }
    return hits
  },
})
