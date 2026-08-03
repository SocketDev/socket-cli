/*
 * @file Waiting-discipline shared core — the rule text plus the blocking-sleep
 *   detector, consumed by `waiting-discipline-nudge` (PreToolUse Bash) and
 *   `long-running-task-nudge` (the PostToolUse background-task clock).
 *
 * The incident shape: an orchestrator watching a long-running background
 * workflow blocked its own foreground on multi-minute `sleep N && poll`
 * cycles — many minutes of silence per cycle with zero interim output — for a
 * run whose completion the workflow system already delivers as a notification.
 * The wait added silence, not information.
 */

// The blocking-sleep threshold, in seconds. Poll loops that keep their silent
// interval within the sanctioned 60-90s band stay under it; anything at or
// past this is a silence budget no foreground wait should spend.
export const WAIT_SLEEP_NUDGE_SECONDS = 120

// The rule, one line per clause, shared verbatim by every surface that
// nudges it so the wording cannot drift between hooks.
export const WAITING_DISCIPLINE_GUIDANCE: readonly string[] = [
  'Waiting discipline:',
  '  - a job that NOTIFIES on completion is never watched with a blocking sleep:',
  '    background it, say what is running and what event comes next, END THE TURN.',
  '  - when polling is genuinely required because nothing notifies, cap each',
  '    silent interval at 60-90s and emit an interim one-liner every cycle:',
  '    what changed, what is still pending.',
  '  - status updates name CONCRETE progress, a result count or a last-activity',
  '    age, never a bare "still running".',
]

// GNU sleep suffixes; a bare number is seconds on every platform.
const SUFFIX_SECONDS = new Map<string, number>([
  ['d', 86_400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
])

// One `sleep` invocation and its duration arguments: `sleep` in command
// position (start of command, or after a separator/subshell opener), followed
// by one or more duration tokens (GNU sleep sums multiple arguments).
const SLEEP_INVOCATION_RE =
  /(?:^|[\s;&|({`])sleep((?:\s+(?:\.\d+|\d+(?:\.\d+)?)[dhms]?)+)/g

/**
 * The longest contiguous silence a command's `sleep` invocations buy, in
 * seconds. Each invocation's duration arguments are summed (GNU semantics);
 * the max across invocations is returned because a poll between two sleeps
 * breaks the silence. Returns `0` for a command with no sleep. Pure.
 */
export function maxBlockingSleepSeconds(command: string): number {
  const flat = command.replace(/\\\n/g, ' ')
  let max = 0
  let m: RegExpExecArray | null
  const re = new RegExp(SLEEP_INVOCATION_RE.source, 'g')
  while ((m = re.exec(flat)) !== null) {
    let total = 0
    const args = m[1]!.trim().split(/\s+/)
    for (let i = 0, { length } = args; i < length; i += 1) {
      // One duration token: a number (`.5`, `5`, or `5.5`) with an optional
      // GNU day/hour/minute/second suffix.
      const parsed = /^(\.\d+|\d+(?:\.\d+)?)([dhms])?$/.exec(args[i]!)
      if (!parsed) {
        continue
      }
      total += Number(parsed[1]) * (SUFFIX_SECONDS.get(parsed[2] ?? 's') ?? 1)
    }
    if (total > max) {
      max = total
    }
  }
  return max
}
