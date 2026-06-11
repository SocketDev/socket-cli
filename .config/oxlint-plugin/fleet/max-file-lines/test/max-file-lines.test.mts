/**
 * @file Unit tests for socket/max-file-lines. Synthesizes files past the soft
 *   (500) and hard (1000) caps to verify both severities fire. The body is `//
 *   line N` lines — minimal valid TypeScript.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

function lines(n: number, prefix = '// line'): string {
  const out: string[] = []
  for (let i = 0; i < n; i += 1) {
    out.push(`${prefix} ${i}`)
  }
  return out.join('\n') + '\n'
}

describe('socket/max-file-lines', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('max-file-lines', rule, {
      valid: [
        { name: 'small file', code: lines(50) },
        { name: 'just under soft cap', code: lines(499) },
        {
          // The marker is HARD-CAP-ONLY: a real category + justification exempts
          // a file PAST 1000 lines (the rare genuine cohesive-unit case).
          name: 'past hard cap with parser-category marker',
          code: `/* max-file-lines: parser — recursive-descent grammar, one cohesive table */\n${lines(1100)}`,
        },
        {
          name: 'past hard cap with state-machine marker',
          code: `/* max-file-lines: state-machine — exhaustive transition table */\n${lines(1100)}`,
        },
        {
          // Categories are open (not a fixed allowlist) — `cli` is fine.
          name: 'past hard cap with cli category marker',
          code: `// max-file-lines: cli — single-command argparse + subcommand flow\n${lines(1100)}`,
        },
      ],
      invalid: [
        {
          name: 'past soft cap',
          code: lines(600),
          errors: [{ messageId: 'soft' }],
        },
        {
          name: 'past hard cap',
          code: lines(1100),
          errors: [{ messageId: 'hard' }],
        },
        {
          // SOFT-BAND marker no longer exempts: a 501–1000 file MUST split, so a
          // valid `<category> — <reason>` marker is IGNORED and `soft` fires.
          name: 'soft-band file with valid marker still reports (hard-cap-only)',
          code: `/* max-file-lines: parser — recursive-descent grammar */\n${lines(600)}`,
          errors: [{ messageId: 'soft' }],
        },
        {
          name: 'soft-band state-machine marker still reports',
          code: `/* max-file-lines: state-machine — exhaustive transition table */\n${lines(600)}`,
          errors: [{ messageId: 'soft' }],
        },
        {
          // Bare `legitimate` (no category) never exempts, at any size.
          name: 'bare legitimate marker is NOT a valid exemption (soft band)',
          code: `/* max-file-lines: legitimate — one cohesive module */\n${lines(600)}`,
          errors: [{ messageId: 'soft' }],
        },
        {
          // `legitimate` is filler, not a category — even past the hard cap.
          name: 'legitimate-prefix past hard cap is still rejected (filler word)',
          code: `// max-file-lines: legitimate parser — grammar\n${lines(1100)}`,
          errors: [{ messageId: 'hard' }],
        },
        {
          // A category with no `— reason` separator is rejected, even past 1000.
          name: 'category with no reason is rejected past hard cap',
          code: `/* max-file-lines: parser */\n${lines(1100)}`,
          errors: [{ messageId: 'hard' }],
        },
      ],
    })
  })
})
