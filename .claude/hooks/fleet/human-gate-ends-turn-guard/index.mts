#!/usr/bin/env node
// Claude Code Stop hook — human-gate-ends-turn-guard.
//
// A rendered 🖐 HUMAN GATE means the flow is BLOCKED on something only the
// operator can clear. The gate must therefore be the LAST thing in the reply.
//
// Why this blocks instead of nudging: a gate that scrolls off the bottom is a
// gate the operator does not act on. Appending status, a `<details>` recap, or
// "meanwhile I also did X" after the gate buries the one line that needs a
// human, and it reads as though the work continued past the block, which is
// the opposite of what a gate asserts. The operator's instruction was direct:
// "if there is a human gate you need to stop after the gate and not keep
// pushing text".
//
// Scope: the LAST gate in the reply. A numbered queue (`[1/3]`, `[2/3]`, …)
// renders several gates together and prose between them is part of the queue,
// so only trailing content after the final `Then:` line is judged.
//
// A closing code fence is allowed, because the fleet renders gates inside a
// fenced block so the operator can copy lane A verbatim. Fences are NOT
// stripped before scanning: that would erase the gate itself.
//
// Naturally quiet once the gate is answered. `readLastAssistantTurnText` reads
// only the entries after the most recent user turn, so once the operator
// replies the gate is no longer in the scanned text and follow-up work is free
// to narrate itself.
//
// No bypass: move the trailing text above the gate, or cut it.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readLastAssistantTurnText } from '../_shared/transcript.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'

// The gate header, as emitted by `formatHumanGate` in
// scripts/fleet/_shared/human-gate.mts and by the identical block in the
// operator's global CLAUDE.md. Matched on the glyph PLUS the label so the
// words "human gate" in ordinary prose do not arm the guard.
const GATE_HEADER_RE = /🖐\s+HUMAN GATE\b/g

// The gate's terminator. `formatHumanGate` always emits `Then:` last, so the
// gate block ends at the end of that line.
const GATE_TERMINATOR_RE = /^[^\S\n]*Then:.*$/m

// What may follow the final gate: blank lines and a closing code fence. A
// fence line is allowed anywhere in the trailing span rather than only first,
// so a gate wrapped in a fence and followed by a blank line still passes.
const ALLOWED_TRAILING_RE = /^(?:[^\S\n]*(?:`{3,}[^\n]*)?\n?)*$/

export interface TrailingGateText {
  readonly gateCount: number
  readonly trailing: string
}

/**
 * The substantive text following the LAST human gate in `text`, or undefined
 * when the reply ends at the gate, or renders no gate at all.
 */
export function findTextAfterGate(text: string): TrailingGateText | undefined {
  const headers = [...text.matchAll(GATE_HEADER_RE)]
  if (!headers.length) {
    return undefined
  }
  const lastHeader = headers[headers.length - 1]!
  const afterHeader = text.slice(lastHeader.index + lastHeader[0].length)
  const terminator = GATE_TERMINATOR_RE.exec(afterHeader)
  if (!terminator) {
    // A gate with no `Then:` line is malformed rather than trailing-text. Gate
    // SHAPE is a separate concern, so stand down instead of mis-reporting.
    return undefined
  }
  const trailing = afterHeader.slice(terminator.index + terminator[0].length)
  if (ALLOWED_TRAILING_RE.test(trailing)) {
    return undefined
  }
  return { gateCount: headers.length, trailing: trailing.trim() }
}

const PREVIEW_LIMIT = 220

export function check(payload: ToolCallPayload): GuardResult {
  const text = readLastAssistantTurnText(payload.transcript_path)
  if (!text) {
    return undefined
  }
  const found = findTextAfterGate(text)
  if (!found) {
    return undefined
  }
  const preview =
    found.trailing.length > PREVIEW_LIMIT
      ? `${found.trailing.slice(0, PREVIEW_LIMIT)}…`
      : found.trailing
  const subject =
    found.gateCount === 1 ? 'a human gate' : `${found.gateCount} human gates`
  return block(
    [
      verdictLine(
        'block',
        'human-gate-ends-turn-guard',
        `the reply keeps going after ${subject} — move the trailing text above the gate or cut it; the gate line ends the turn (no bypass)`,
      ),
      ...preview.split('\n').map(line => verdictContinuation(`│ ${line}`)),
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  // MACHINE-WIDE: a gate is rendered wherever the operator is blocked, which is
  // not a fleet-repo-only event. Push-grant and browser-auth gates surface most
  // often from foreign checkouts, which is exactly where a repo-scoped hook is
  // absent.
  global: true,
  type: 'guard',
})

void runHook(hook, import.meta.url)
