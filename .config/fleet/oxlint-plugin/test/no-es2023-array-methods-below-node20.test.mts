/**
 * @file Unit tests for socket/no-es2023-array-methods-below-node20. The rule is
 *   engine-aware: it reads `engines.node` from the nearest package.json and
 *   only fires when the floor is below Node 20. The RuleTester drives both arms
 *   by writing a controlled `package.json` next to each fixture (its
 *   `packageJson` field), so a Node-18 floor exercises the invalid arm and a
 *   Node-22 floor exercises the valid arm. The pure semver/floor helpers are
 *   covered alongside.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { RuleTester } from '../lib/rule-tester.mts'
import rule, {
  parseNodeFloorMajor,
} from '../rules/no-es2023-array-methods-below-node20.mts'

const NODE_18 = { engines: { node: '>=18.20.8' } }
const NODE_22 = { engines: { node: '>=22.0.0' } }

describe('socket/no-es2023-array-methods-below-node20', () => {
  test('parseNodeFloorMajor reads the leading major', () => {
    assert.equal(parseNodeFloorMajor('>=18'), 18)
    assert.equal(parseNodeFloorMajor('>= 18.20.8'), 18)
    assert.equal(parseNodeFloorMajor('^20.0.0'), 20)
    assert.equal(parseNodeFloorMajor('>=26.0.0'), 26)
    assert.equal(parseNodeFloorMajor('*'), undefined)
  })

  test('valid + invalid cases', () => {
    new RuleTester().run('no-es2023-array-methods-below-node20', rule, {
      valid: [
        {
          // Node-22 floor: the methods are available, so allowed.
          name: 'toSorted in a Node-22 package',
          filename: 'src/foo.mts',
          packageJson: NODE_22,
          code: 'const b = a.toSorted()\nconsole.log(b)\n',
        },
        {
          // Node-18 floor but an unrelated method — not the ES2023 quartet.
          name: 'map in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.map(x => x)\nconsole.log(b)\n',
        },
        {
          // No engines field: assumed evergreen, allowed.
          name: 'toReversed with no engines field',
          filename: 'src/foo.mts',
          packageJson: { name: 'x' },
          code: 'const b = a.toReversed()\nconsole.log(b)\n',
        },
      ],
      invalid: [
        {
          name: 'toSorted in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.toSorted()\nconsole.log(b)\n',
          errors: [{ messageId: 'es2023ArrayMethod' }],
        },
        {
          name: 'toReversed in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.toReversed()\nconsole.log(b)\n',
          errors: [{ messageId: 'es2023ArrayMethod' }],
        },
        {
          name: 'with(...) in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.with(0, 1)\nconsole.log(b)\n',
          errors: [{ messageId: 'es2023ArrayMethod' }],
        },
      ],
    })
  })
})
