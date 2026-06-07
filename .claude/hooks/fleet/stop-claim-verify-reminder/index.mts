#!/usr/bin/env node
// Claude Code Stop hook — stop-claim-verify-reminder.
//
// Fires at turn-end. Scans the last assistant turn for a SELF-CLAIM that an
// action succeeded — "tests pass", "the build succeeds", "X is fixed",
// "verified" — and checks whether a tool call THIS SESSION actually ran the
// command that would back it. When the claim has no backing tool call, emits a
// stderr reminder: run it, or qualify the claim.
//
// The fleet rule (CLAUDE.md "Judgment & self-evaluation" → "Verify before you
// claim"): never assert "tests pass" / "builds" / "X exists" without a tool call
// this session that ran or read it. This is the verify-before-CLAIM sibling of
// verify-before-TRUST — `excuse-detector` already catches relaying ANOTHER
// agent's unverified count; this catches the assistant's OWN unbacked success
// claim, the failure mode where a turn ends "done, tests pass" with no test run.
//
// Why a reminder, not a block: Stop hooks fire after the turn ended; there is no
// tool call to refuse. The reminder surfaces the unbacked claim at the very turn
// that made it, so the assistant runs the check (or qualifies) next turn.
//
// Categories + their backing-command signals (a claim fires only when NONE of
// its signals appears in any Bash command run this session):
//   - tests   : "tests pass" / "all tests green" → vitest / `pnpm test` / node --test
//   - build   : "the build succeeds" / "builds clean" → `pnpm build` / `run build` / tsgo / rolldown
//   - typecheck: "typechecks" / "no type errors" → tsgo / tsc / `run check`
//   - lint    : "lint passes" / "lint is clean" → oxlint / `run lint` / `run check`
//
// A claim wrapped in a code fence (an example, a quoted plan) is ignored —
// code-fence stripping is always on.
//
// Exit code: 0 always (informational; never blocks). Fail-open on any error.

import process from 'node:process'

import {
  extractToolUseBlocks,
  readLastAssistantText,
  readLines,
  resolveRoleAndContent,
  stripCodeFences,
} from '../_shared/transcript.mts'

export interface ClaimRule {
  // Category label for the reminder.
  readonly label: string
  // Matches the self-claim in the assistant's prose.
  readonly claim: RegExp
  // Substrings that, in ANY Bash command this session, back the claim.
  readonly backedBy: readonly RegExp[]
  // One-line nudge.
  readonly hint: string
}

export const CLAIM_RULES: readonly ClaimRule[] = [
  {
    label: 'tests pass',
    claim:
      /\b(?:all )?tests?\b[^.!?\n]{0,30}\b(?:pass(?:ed|ing)?|green|succeed(?:ed)?)\b/i,
    backedBy: [/\bvitest\b/, /\bpnpm\s+(?:run\s+)?test\b/, /\bnode\s+--test\b/],
    hint: 'run the test command (`pnpm test` / `vitest run <file>`) or qualify the claim',
  },
  {
    label: 'build succeeds',
    claim:
      /\bbuild(?:s|ed)?\b[^.!?\n]{0,30}\b(?:succeed(?:ed|s)?|clean|pass(?:ed|es)?|work(?:s|ed)?)\b/i,
    backedBy: [
      /\bpnpm\s+(?:run\s+)?build\b/,
      /\brun\s+build\b/,
      /\brolldown\b/,
    ],
    hint: 'run the build or qualify the claim',
  },
  {
    label: 'typechecks',
    claim:
      /\b(?:type[- ]?checks?\b[^.!?\n]{0,20}\b(?:pass(?:es|ed)?|clean)|no type errors)\b/i,
    backedBy: [/\btsgo\b/, /\btsc\b/, /\bpnpm\s+(?:run\s+)?check\b/],
    hint: 'run tsgo / `pnpm run check` or qualify the claim',
  },
  {
    label: 'lint passes',
    claim: /\blint(?:ing)?\b[^.!?\n]{0,25}\b(?:pass(?:es|ed)?|clean|green)\b/i,
    backedBy: [
      /\boxlint\b/,
      /\bpnpm\s+(?:run\s+)?lint\b/,
      /\bpnpm\s+(?:run\s+)?check\b/,
    ],
    hint: 'run `pnpm run lint` / `pnpm run check` or qualify the claim',
  },
  {
    label: 'render verified',
    // A self-claim that the UI / popup / page was visually checked — "verified
    // the popup", "the UI renders correctly", "looks good on screen", "rendered
    // to PNG", "visually verified". Backed ONLY by an actual render this session.
    claim:
      /\b(?:visually verif(?:y|ied)|verif(?:y|ied)\b[^.!?\n]{0,30}\b(?:popup|render|ui\b|screen|pixels?)|(?:popup|ui|render(?:ed|s)?|page|screen)\b[^.!?\n]{0,30}\b(?:looks? (?:good|correct|right)|renders? (?:correctly|fine)|verified))\b/i,
    backedBy: [
      /\bscreenshot\.mts\b/,
      /\brendering-chromium-to-png\b/,
      /\bplaywright\b/,
      /\bchromium\b/,
    ],
    hint: 'render the page to a PNG (rendering-chromium-to-png / screenshot.mts) and Read the pixels this session, or qualify the claim — bundle/build success is not visual verification',
  },
]

interface StopPayload {
  transcript_path?: string | undefined
}

// Every Bash command string run by the assistant across the whole session.
export function sessionBashCommands(
  transcriptPath: string | undefined,
): string[] {
  const lines = readLines(transcriptPath)
  const commands: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    const r = resolveRoleAndContent(evt)
    if (!r || r.role !== 'assistant') {
      continue
    }
    const tools = extractToolUseBlocks(r.content)
    for (let j = 0, { length: tl } = tools; j < tl; j += 1) {
      const t = tools[j]!
      if (t.name !== 'Bash') {
        continue
      }
      const cmd = t.input['command']
      if (typeof cmd === 'string') {
        commands.push(cmd)
      }
    }
  }
  return commands
}

export interface UnbackedClaim {
  readonly label: string
  readonly hint: string
}

export function findUnbackedClaims(
  assistantText: string,
  bashCommands: readonly string[],
): UnbackedClaim[] {
  const text = stripCodeFences(assistantText)
  const joined = bashCommands.join('\n')
  const out: UnbackedClaim[] = []
  for (let i = 0, { length } = CLAIM_RULES; i < length; i += 1) {
    const rule = CLAIM_RULES[i]!
    if (!rule.claim.test(text)) {
      continue
    }
    const backed = rule.backedBy.some(re => re.test(joined))
    if (!backed) {
      out.push({ label: rule.label, hint: rule.hint })
    }
  }
  return out
}

async function drainStdin(): Promise<string> {
  return await new Promise<string>(resolve => {
    let chunks = ''
    process.stdin.on('data', d => {
      chunks += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve(chunks))
    process.stdin.on('error', () => resolve(''))
  })
}

async function main(): Promise<void> {
  let payload: StopPayload
  try {
    payload = JSON.parse(await drainStdin()) as StopPayload
  } catch {
    return
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    return
  }
  const unbacked = findUnbackedClaims(
    text,
    sessionBashCommands(payload.transcript_path),
  )
  if (!unbacked.length) {
    return
  }
  const lines = unbacked.map(u => `  - "${u.label}" — ${u.hint}`)
  process.stderr.write(
    [
      '[stop-claim-verify-reminder] A success claim this turn has no backing tool call this session:',
      ...lines,
      '',
      'Verify before you claim: run the command (and let its output show), or',
      'qualify the statement ("I have not run the tests"). This is the',
      'verify-before-CLAIM sibling of verify-before-trust.',
    ].join('\n'),
  )
}

if (process.argv[1]?.endsWith('index.mts')) {
  await main()
}
