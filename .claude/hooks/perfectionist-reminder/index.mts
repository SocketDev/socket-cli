#!/usr/bin/env node
// Claude Code Stop hook — perfectionist-reminder.
//
// Flags speed-vs-depth choice menus in the assistant's most recent
// turn. CLAUDE.md "Judgment & self-evaluation" says "Default to
// perfectionist when you have latitude" — so when the assistant
// presents a choice between "speed" and "depth" / "correctness"
// without the user having asked for the trade-off, it's the same
// failure pattern as the excuse-detector's fix-vs-defer menu:
// offloading a decision the assistant should have made.
//
// What this catches (regex on code-fence-stripped text):
//
//   - "Option A (depth): ... Option B (speed): ..."
//   - "Maximally useful vs maximally shipped"
//   - "Ship-it precision" / "ship-it-now"
//   - "Depth over breadth?" / "breadth over depth?"
//   - "Speed vs depth" / "speed vs correctness" / "fast vs right"
//   - "If you say A I'll ... if you say B I'll ..." (binary choice
//     architecture)
//
// Exceptions: the user explicitly asked which approach to take, or
// the trade-off is genuinely irreducible (time-boxed engagement,
// off-machine action required). The hook can't tell from text alone;
// it just flags the pattern. The user reads the warning and decides
// if it's legitimate or pushback-worthy.
//
// Disable via SOCKET_PERFECTIONIST_REMINDER_DISABLED.

import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'perfectionist-reminder',
  disabledEnvVar: 'SOCKET_PERFECTIONIST_REMINDER_DISABLED',
  patterns: [
    {
      label: 'option A (depth/correctness) … option B (speed/shipped)',
      regex: /\boption\s+a\b[^.?!\n]{0,80}\b(depth|correctness|proper|thorough)\b[\s\S]{0,200}\boption\s+b\b[^.?!\n]{0,80}\b(speed|fast|ship|breadth)\b/i,
      why: 'Speed-vs-depth choice menu. Per CLAUDE.md "Default to perfectionist when you have latitude" — pick depth and execute.',
    },
    {
      label: 'maximally useful vs maximally shipped',
      regex: /\bmaximally\s+(useful|correct|thorough)\b[\s\S]{0,80}\bmaximally\s+(shipped|fast|quick)\b/i,
      why: 'Same pattern — re-litigating perfectionist-vs-velocity. User already chose perfectionist.',
    },
    {
      label: 'ship-it precision / ship-it-now',
      regex: /\bship[- ]it[- ]?(now|precision|fast|version)\b/i,
      why: 'Velocity-framed; CLAUDE.md says perfectionist default. Use unless user explicitly time-boxed.',
    },
    {
      label: 'depth over breadth / breadth over depth',
      regex: /\b(depth\s+over\s+breadth|breadth\s+over\s+depth)\?/i,
      why: 'The CLAUDE.md default is depth (perfectionist). Pick it.',
    },
    {
      label: 'speed vs depth / fast vs right / now vs correct',
      regex: /\b(speed|fast|quick|now)\s+vs\.?\s+(depth|right|correct|proper|thorough)\b/i,
      why: 'Same speed-vs-quality framing; perfectionist is the default unless user opted out.',
    },
    {
      label: 'if you say A … if you say B',
      regex: /\bif\s+you\s+say\s+a\b[\s\S]{0,200}\bif\s+you\s+say\s+b\b/i,
      why: 'Binary choice architecture — masquerades as helpful framing but offloads judgment to user.',
    },
    {
      label: 'plow through vs do it right',
      regex: /\bplow\s+(through|ahead)\b[\s\S]{0,80}\b(properly|carefully|right|correctly)\b/i,
      why: 'Same pattern (velocity vs care). Default perfectionist.',
    },
  ],
  closingHint:
    'CLAUDE.md "Judgment & self-evaluation": "Default to perfectionist when you have latitude." If the user already gave perfectionist signals (asked for correctness, asked for depth, said "do it right"), do not re-present the choice — execute the perfectionist path.',
})
