/**
 * @file Unit tests for socket/require-async-iife-entry — flags a floating `void
 *   main()` / `main()` in a module-scope entry guard, accepts the async IIFE
 *   form, and stays out of no-top-level-await's lane.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

const GUARD = "if (process.argv[1]?.endsWith('index.mts')) {"

describe('socket/require-async-iife-entry', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('require-async-iife-entry', rule, {
      valid: [
        {
          name: 'async IIFE form is accepted',
          code: `async function main() {}\n${GUARD}\n  void (async () => { await main() })()\n}\n`,
        },
        {
          name: 'a non-async main() is not flagged',
          code: `function main() {}\n${GUARD}\n  main()\n}\n`,
        },
        {
          name: 'no entry guard -> not checked',
          code: 'async function main() {}\nvoid main()\n',
        },
      ],
      invalid: [
        {
          // The entry rule owns all three wrong forms; await main() here gets
          // the specific IIFE fix (no-top-level-await is the general backstop).
          name: 'await main() in the entry guard is flagged (awaited form)',
          code: `async function main() {}\n${GUARD}\n  await main()\n}\n`,
          errors: [{ messageId: 'awaited' }],
        },
        {
          name: 'floating void main() in the entry guard is flagged',
          code: `async function main() {}\n${GUARD}\n  void main()\n}\n`,
          errors: [{ messageId: 'floating' }],
        },
        {
          name: 'bare main() in the entry guard is flagged',
          code: `async function main() {}\n${GUARD}\n  main()\n}\n`,
          errors: [{ messageId: 'floating' }],
        },
        {
          name: 'async arrow const main flagged when floated',
          code: `const main = async () => {}\n${GUARD}\n  void main()\n}\n`,
          errors: [{ messageId: 'floating' }],
        },
      ],
    })
  })
})
