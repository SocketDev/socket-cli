/**
 * @file Unit tests for socket/sort-array-literals — the opt-in `/* sort *​/`
 *   array-element sorter. Asserts it fires ONLY on marked arrays, uses fleet
 *   ASCII byte order (uppercase before lowercase), autofixes to the exact
 *   sorted text, and leaves unmarked / position-bearing arrays alone.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-array-literals.mts'

describe('socket/sort-array-literals', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-array-literals', rule, {
      valid: [
        {
          name: 'marked + already sorted (ASCII: uppercase before lowercase)',
          code: '/* sort */\nexport const a = ["Beta", "alpha", "gamma"]\n',
        },
        {
          // No marker -> the rule must not touch a position-bearing array.
          name: 'unmarked unsorted array is left alone',
          code: 'export const order = ["gamma", "alpha", "beta"]\n',
        },
        {
          name: 'marked single-element array',
          code: '/* sort */\nexport const a = ["solo"]\n',
        },
        {
          name: 'marked spread-bearing array is skipped',
          code: '/* sort */\nexport const a = [...x, ...y]\n',
        },
        {
          // A different leading block comment is not the marker.
          name: 'non-marker comment does not activate the rule',
          code: '/* not the marker */\nexport const a = ["b", "a"]\n',
        },
      ],
      invalid: [
        {
          name: 'marked + unsorted autofixes to ASCII order',
          code: '/* sort */\nexport const a = ["gamma", "alpha", "Beta"]\n',
          errors: [{ messageId: 'unsorted' }],
          output: '/* sort */\nexport const a = ["Beta", "alpha", "gamma"]\n',
        },
        {
          name: 'marked + uppercase sorts before lowercase (byte order)',
          code: '/* sort */\nconst a = ["boshen_c", "JoviDeC"]\n',
          errors: [{ messageId: 'unsorted' }],
          output: '/* sort */\nconst a = ["JoviDeC", "boshen_c"]\n',
        },
        {
          name: 'marked + mixed-type elements are flagged, not fixed',
          code: '/* sort */\nexport const a = ["alpha", foo, "beta"]\n',
          errors: [{ messageId: 'unsortedNoFix' }],
        },
      ],
    })
  })
})
