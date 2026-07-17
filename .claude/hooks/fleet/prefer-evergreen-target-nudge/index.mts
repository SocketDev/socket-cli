#!/usr/bin/env node
// Claude Code Stop hook — prefer-evergreen-target-nudge.
//
// Nudges when the last assistant turn introduced a conservative build/lang
// target where an evergreen one fits. The fleet default is latest-and-greatest:
// for an auto-updating runtime (a Chrome extension, the web, a CI-pinned Node)
// a back-versioned `tsconfig` `target`/`lib` leaves modern syntax downleveled
// or untyped for no benefit. JSON config (tsconfig, package.json, browserslist)
// is not lintable by oxlint, so this Stop nudge is the only enforcement surface
// for the principle (see docs/agents.md/fleet/drift-watch.md "Evergreen").
//
// Reminder, not a blocker: signals a finding by writing to stderr, always
// exits 0. Bypass: `Allow evergreen-target bypass` in a recent user message.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
  extractCodeFences,
  readLastAssistantText,
} from '../_shared/transcript.mts'

interface Finding {
  saw: string
  want: string
}

const BYPASS_PHRASE = 'Allow evergreen-target bypass'

// A year-stamped ES target below this is "conservative" — nudge toward ESNext.
// Bump the floor as the fleet baseline moves; the point is "don't pin an old
// year", not a specific number.
const ES_YEAR_FLOOR = 2024

// `ES<year>` token (target value or lib-array entry). `ESNext` has no 4-digit
// run, so it never matches.
const ES_YEAR_RE = /\bES(?<year>\d{4})\b/g

// Only scan a block that looks like a tsconfig — otherwise prose discussing
// "ES2020 added X" would false-positive. A `"target"`/`"lib"`/`compilerOptions`
// key or the word `tsconfig` is the signal.
const TSCONFIG_SIGNAL_RE = /["'](?:target|lib|compilerOptions)["']|tsconfig/i

export function findFindings(text: string): Finding[] {
  if (!TSCONFIG_SIGNAL_RE.test(text)) {
    return []
  }
  const years = new Set<string>()
  let m: RegExpExecArray | null
  ES_YEAR_RE.lastIndex = 0
  // oxlint-disable-next-line no-cond-assign -- standard global-regex exec loop.
  while ((m = ES_YEAR_RE.exec(text))) {
    const year = m.groups!.year!
    if (Number(year) < ES_YEAR_FLOOR) {
      years.add(year)
    }
  }
  const out: Finding[] = []
  for (const year of years) {
    out.push({
      saw: `ES${year}`,
      want: 'ESNext (or the latest the runtime supports)',
    })
  }
  return out
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    return undefined
  }
  // Scan the prose AND code fences — a tsconfig edit shows up as a fenced
  // json/jsonc block or inline in the diff narration.
  const haystacks = [text, ...extractCodeFences(text).map(b => b.body)]
  const seen = new Set<string>()
  const findings: Finding[] = []
  for (let i = 0, { length } = haystacks; i < length; i += 1) {
    const found = findFindings(haystacks[i]!)
    for (let fi = 0, { length: flen } = found; fi < flen; fi += 1) {
      const f = found[fi]!
      if (seen.has(f.saw)) {
        continue
      }
      seen.add(f.saw)
      findings.push(f)
    }
  }
  if (findings.length === 0) {
    return undefined
  }
  const lines = [
    '[prefer-evergreen-target-nudge] Conservative build/lang target spotted:',
    '',
  ]
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  • saw ${f.saw}, prefer ${f.want}`)
  }
  lines.push('')
  lines.push(
    '  Fleet default is evergreen / latest-and-greatest. For an auto-updating',
  )
  lines.push(
    '  runtime (Chrome extension, web, CI-pinned Node) pin the latest target,',
  )
  lines.push('  not a back-version.')
  lines.push(`  Bypass: type "${BYPASS_PHRASE}" verbatim in a recent message.`)
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
