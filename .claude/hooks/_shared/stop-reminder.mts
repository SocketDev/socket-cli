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

  const hits: ReminderHit[] = []
  const { patterns } = config
  const { length: patternsLength } = patterns
  for (let i = 0; i < patternsLength; i += 1) {
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

  if (config.extraCheck) {
    try {
      const extra = await config.extraCheck(text)
      for (
        let i = 0, { length: extraLength } = extra;
        i < extraLength;
        i += 1
      ) {
        hits.push(extra[i]!)
      }
    } catch {
      // Fail-open: a buggy extra-check must not suppress the regex hits.
    }
  }

  if (hits.length === 0) {
    process.exit(0)
  }

  const lines = [
    `[${config.name}] Assistant turn matched reminder patterns:`,
    '',
    ...hits.flatMap(h => [`  • "${h.label}" — ${h.snippet}`, `      ${h.why}`]),
  ]
  if (config.closingHint) {
    lines.push('', `  ${config.closingHint}`)
  }
  lines.push('')
  const message = lines.join('\n')

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
