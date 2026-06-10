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
          // A real structural category + justification exempts the file.
          name: 'over cap with parser-category marker',
          code: `/* max-file-lines: parser — recursive-descent grammar, one cohesive table */\n${lines(600)}`,
        },
        {
          name: 'over cap with state-machine marker',
          code: `/* max-file-lines: state-machine — exhaustive transition table */\n${lines(600)}`,
        },
        {
          // Categories are open (not a fixed allowlist) — `cli` is fine.
          name: 'over cap with cli category marker',
          code: `// max-file-lines: cli — single-command argparse + subcommand flow\n${lines(600)}`,
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
          // Bare `legitimate` (no category) no longer exempts.
          name: 'bare legitimate marker is NOT a valid exemption',
          code: `/* max-file-lines: legitimate — one cohesive module */\n${lines(600)}`,
          errors: [{ messageId: 'soft' }],
        },
        {
          // `legitimate` is filler, not a category — even with a category word
          // after it, the marker must lead with the real category.
          name: 'legitimate-prefix before a category is rejected (filler word)',
          code: `// max-file-lines: legitimate parser — grammar\n${lines(600)}`,
          errors: [{ messageId: 'soft' }],
        },
        {
          // A category with no `— reason` separator is rejected.
          name: 'category with no reason is rejected',
          code: `/* max-file-lines: parser */\n${lines(600)}`,
          errors: [{ messageId: 'soft' }],
        },
      ],
    })
  })
})
