/**
 * @fileoverview Unit tests for socket/max-file-lines.
 *
 * Synthesizes files past the soft (500) and hard (1000) caps to
 * verify both severities fire. The body is `// line N` lines —
 * minimal valid TypeScript.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/max-file-lines.mts'

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
      ],
    })
  })
})
