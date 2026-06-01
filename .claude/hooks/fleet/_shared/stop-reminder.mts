/**
 * @file Shared scaffold for Stop-hook reminders. Most fleet reminders share the
 *   same shape:
 *
 *   1. Read the Stop payload JSON from stdin.
 *   2. Read the most-recent assistant turn from the transcript.
 *   3. Run a list of regex patterns against the (code-fence-stripped) text.
 *   4. If any match, emit a stderr block summarizing the hits.
 *   5. Always exit 0 (informational). This module factors that loop so each new
 *      reminder is just a name + env-var + pattern list. Keeps every hook under
 *      ~50 lines and ensures the harness contract (JSON parse, fail-open,
 *      code-fence strip) lives in one place.
 */

import process from 'node:process'

import {
  readLastAssistantText,
  readStdin,
  readUserText,
  stripCodeFences,
  stripQuotedSpans,
} from './transcript.mts'

/**
 * Pull a ~80-char snippet around the match for the warning message.
 */
export function extractSnippet(
  text: string,
  index: number,
  length: number,
): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

interface StopPayload {
  readonly transcript_path?: string | undefined
  readonly stop_hook_active?: boolean | undefined
}

export interface RuleViolation {
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

export interface ReminderHit {
  readonly label: string
  readonly why: string
  readonly snippet: string
}

export interface ReminderConfig {
  readonly name: string
  readonly disabledEnvVar: string
  readonly patterns: readonly RuleViolation[]
  readonly closingHint?: string | undefined
  /**
   * Optional extra check, invoked after the regex sweep. Receives the
   * code-fence-stripped text and returns any additional hits to merge with the
   * regex matches. Use when the regex layer is insufficient (e.g. NLP
   * modal-verb detection in judgment-reminder).
   *
   * Fail-open: if the check throws, the hook ignores it and reports only the
   * regex hits. A buggy extra-check must not block the rest of the warning
   * surface.
   */
  readonly extraCheck?:
    | ((
        text: string,
      ) => readonly ReminderHit[] | Promise<readonly ReminderHit[]>)
    | undefined
  /**
   * When true, hits trigger a blocking Stop-hook decision so the assistant must
   * continue the turn and address the matched phrase rather than ending on the
   * excuse. The block is suppressed when Claude Code reports `stop_hook_active:
   * true` to avoid loops.
   */
  readonly blocking?: boolean | undefined
  /**
   * When true, strip ASCII / smart quoted spans from the scanned text before
   * pattern-matching. Stop hooks that detect _meta-discussion_ of phrases (e.g.
   * excuse-detector explaining what it detects) should enable this so the hook
   * doesn't self-fire on its own changelog or post-mortem. Code-fence stripping
   * is always on; this is the narrower, prose-only escape hatch.
   */
  readonly stripQuotedSpans?: boolean | undefined
}

/**
 * A reminder rule-group for the multiplexed `runStopReminders`. Same shape as
 * ReminderConfig minus the process-lifecycle bits (name + per-group env var +
 * patterns + hint); `blocking` is intentionally absent — a multiplexed group is
 * informational only (mixing block + non-block decisions across groups in one
 * process can't emit a single coherent Stop decision).
 */
export interface ReminderGroup {
  readonly name: string
  readonly disabledEnvVar: string
  readonly patterns: readonly RuleViolation[]
  readonly closingHint?: string | undefined
  readonly stripQuotedSpans?: boolean | undefined
}

/**
 * Scan `text` against a pattern list (+ optional extraCheck), returning hits.
 * The pure core shared by `runStopReminder` and `runStopReminders`.
 */
export async function scanReminderText(
  text: string,
  patterns: readonly RuleViolation[],
  extraCheck?: ReminderConfig['extraCheck'],
): Promise<ReminderHit[]> {
  const hits: ReminderHit[] = []
  for (let i = 0, { length } = patterns; i < length; i += 1) {
    const pattern = patterns[i]!
    const match = pattern.regex.exec(text)
    if (!match) {
      continue
    }
    hits.push({
      label: pattern.label,
      why: pattern.why,
      snippet: extractSnippet(text, match.index, match[0].length),
    })
  }
  if (extraCheck) {
    try {
      const extra = await extraCheck(text)
      for (let i = 0, { length } = extra; i < length; i += 1) {
        hits.push(extra[i]!)
      }
    } catch {
      // Fail-open: a buggy extra-check must not suppress the regex hits.
    }
  }
  return hits
}

/**
 * Format the stderr block for one group's hits.
 */
export function formatReminderBlock(
  name: string,
  hits: readonly ReminderHit[],
  closingHint?: string | undefined,
): string {
  const lines = [
    `[${name}] Assistant turn matched reminder patterns:`,
    '',
    ...hits.flatMap(h => [`  • "${h.label}" — ${h.snippet}`, `      ${h.why}`]),
  ]
  if (closingHint) {
    lines.push('', `  ${closingHint}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Run several informational reminder groups in ONE Stop-hook process. Reads
 * stdin + the most-recent assistant turn once, then scans each group whose
 * `disabledEnvVar` is unset — preserving per-group disabling exactly as if each
 * were its own hook. Emits one stderr block per group with hits. Always exits 0.
 * Use when merging pure-table reminders to cut process count without losing the
 * granular disable env vars.
 */
export async function runStopReminders(
  groups: readonly ReminderGroup[],
): Promise<void> {
  const payloadRaw = await readStdin()
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    process.exit(0)
  }
  const fencesStripped = stripCodeFences(rawText)
  const blocks: string[] = []
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const group = groups[i]!
    if (process.env[group.disabledEnvVar]) {
      continue
    }
    const text = group.stripQuotedSpans
      ? stripQuotedSpans(fencesStripped)
      : fencesStripped
    // eslint-disable-next-line no-await-in-loop
    const hits = await scanReminderText(text, group.patterns)
    if (hits.length > 0) {
      blocks.push(formatReminderBlock(group.name, hits, group.closingHint))
    }
  }
  if (blocks.length === 0) {
    process.exit(0)
  }
  process.stderr.write(blocks.join('\n') + '\n')
  process.exit(0)
}

/**
 * Run a Stop-hook reminder. Reads stdin, scans the most-recent assistant turn,
 * and writes hits to stderr. Always exits 0.
 */
export async function runStopReminder(config: ReminderConfig): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env[config.disabledEnvVar]) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }

  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    process.exit(0)
  }
  const fencesStripped = stripCodeFences(rawText)
  const text = config.stripQuotedSpans
    ? stripQuotedSpans(fencesStripped)
    : fencesStripped

  const hits = await scanReminderText(text, config.patterns, config.extraCheck)

  if (hits.length === 0) {
    process.exit(0)
  }

  const message = formatReminderBlock(config.name, hits, config.closingHint)

  // Blocking mode: emit a Stop-hook block decision so Claude must
  // continue the turn and address the matched phrase. Suppressed
  // when `stop_hook_active` is already set, to avoid loops.
  if (config.blocking && !payload.stop_hook_active) {
    const reason =
      message +
      '\nFix the underlying issue now (or, if it truly cannot be fixed in this session, ' +
      'say so explicitly with the trade-off — do not end the turn on the excuse phrase).'
    process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n')
    process.exit(0)
  }

  process.stderr.write(message + '\n')
  process.exit(0)
}

/**
 * Config for a turn-pair reminder: fires only when the last USER turn matches a
 * trigger AND the most-recent ASSISTANT turn matches a deflection. The shape
 * shared by answer-passing-questions / answer-status-requests /
 * follow-direct-imperative — "user asked X, assistant did Y instead".
 */
/**
 * A turn-pair matcher. `label` + `why` describe it; matching is by `regex`
 * OR — when the rule needs logic a regex can't express (word-count bounds,
 * first-word-only, question filtering, like follow-direct-imperative's
 * `looksLikeImperative`) — by an explicit `match` predicate. Exactly one of
 * `regex` / `match` is consulted (`match` wins when present).
 */
export interface TurnPairRule {
  readonly label: string
  readonly why: string
  readonly regex?: RegExp | undefined
  readonly match?: ((text: string) => boolean) | undefined
}

export interface TurnPairConfig {
  readonly name: string
  readonly disabledEnvVar: string
  readonly userTriggers: readonly TurnPairRule[]
  readonly assistantDeflections: readonly TurnPairRule[]
  readonly closingHint?: string | undefined
}

function turnPairMatches(rule: TurnPairRule, text: string): boolean {
  if (rule.match) {
    return rule.match(text)
  }
  return rule.regex ? rule.regex.test(text) : false
}

/**
 * Run a turn-pair Stop reminder. Reads the last user turn + the most-recent
 * assistant turn (via transcript.mts — no per-hook re-implementation of
 * JSONL parsing / role detection / content flattening), and emits a reminder
 * only when BOTH a user trigger and an assistant deflection match. Always
 * exits 0. The fired message names the matched trigger + deflection so the
 * reader sees what pair tripped it.
 */
export async function runTurnPairReminder(
  config: TurnPairConfig,
): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env[config.disabledEnvVar]) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }
  const userText = stripCodeFences(readUserText(payload.transcript_path, 1))
  const assistantText = stripCodeFences(
    readLastAssistantText(payload.transcript_path),
  )
  if (!userText || !assistantText) {
    process.exit(0)
  }
  const trigger = config.userTriggers.find(p => turnPairMatches(p, userText))
  if (!trigger) {
    process.exit(0)
  }
  const deflection = config.assistantDeflections.find(p =>
    turnPairMatches(p, assistantText),
  )
  if (!deflection) {
    process.exit(0)
  }
  const userPreview = userText.trim().slice(0, 60).replace(/\s+/g, ' ')
  const lines = [
    `[${config.name}] User asked, assistant deflected:`,
    '',
    `  User trigger: "${trigger.label}" — "${userPreview}"`,
    `  Assistant deflection: "${deflection.label}"`,
    `      ${deflection.why}`,
  ]
  if (config.closingHint) {
    lines.push('', `  ${config.closingHint}`)
  }
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}
