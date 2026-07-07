/**
 * @file Unit tests for socket/no-runtime-features-below-engine-floor. The rule
 *   is engine-aware: it reads `engines.node` from the nearest package.json and
 *   fires per feature only when the floor is below that feature's Node major.
 *   The RuleTester drives both arms by writing a controlled `package.json` next
 *   to each fixture (its `packageJson` field): a Node-18 floor exercises the
 *   invalid arm for every feature, while a per-feature at-or-above floor
 *   exercises the valid arm. The pure semver/floor helpers are covered
 *   alongside. Coverage spans ES2023 (array copy/find, Node 20), ES2024
 *   (Object/Map.groupBy → 21, Promise.withResolvers → 22) and ES2026
 *   (Array.fromAsync → 22).
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule, {
  nearestEnginesNodeFloor,
  parseNodeFloorMajor,
} from '../index.mts'

const NODE_18 = { engines: { node: '>=18.20.8' } }
const NODE_20 = { engines: { node: '>=20.0.0' } }
const NODE_21 = { engines: { node: '>=21.0.0' } }
const NODE_22 = { engines: { node: '>=22.0.0' } }

describe('socket/no-runtime-features-below-engine-floor', () => {
  test('parseNodeFloorMajor reads the leading major', () => {
    assert.equal(parseNodeFloorMajor('>=18'), 18)
    assert.equal(parseNodeFloorMajor('>= 18.20.8'), 18)
    assert.equal(parseNodeFloorMajor('^20.0.0'), 20)
    assert.equal(parseNodeFloorMajor('>=26.0.0'), 26)
    assert.equal(parseNodeFloorMajor('*'), undefined)
  })

  test('nearestEnginesNodeFloor returns undefined at the filesystem root', () => {
    assert.equal(nearestEnginesNodeFloor('/'), undefined)
  })

  test('valid + invalid cases', () => {
    new RuleTester().run('no-runtime-features-below-engine-floor', rule, {
      valid: [
        {
          // Node-22 floor: the methods are available, so allowed.
          name: 'toSorted in a Node-22 package',
          filename: 'src/foo.mts',
          packageJson: NODE_22,
          code: 'const b = a.toSorted()\nconsole.log(b)\n',
        },
        {
          // Node-18 floor but an unrelated method — not covered.
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
        {
          // findLast is Node-20; a Node-20 floor is at the bar, so allowed.
          name: 'findLast in a Node-20 package',
          filename: 'src/foo.mts',
          packageJson: NODE_20,
          code: 'const b = a.findLast(x => x)\nconsole.log(b)\n',
        },
        {
          // Object.groupBy is Node-21; a Node-21 floor is at the bar, allowed.
          name: 'Object.groupBy in a Node-21 package',
          filename: 'src/foo.mts',
          packageJson: NODE_21,
          code: 'const b = Object.groupBy(a, x => x)\nconsole.log(b)\n',
        },
        {
          // Promise.withResolvers is Node-22; a Node-22 floor is at the bar.
          name: 'Promise.withResolvers in a Node-22 package',
          filename: 'src/foo.mts',
          packageJson: NODE_22,
          code: 'const b = Promise.withResolvers()\nconsole.log(b)\n',
        },
        {
          // A local object named like a global must NOT false-fire.
          name: 'local promise.withResolvers in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const promise = makeThing()\nconst b = promise.withResolvers()\nconsole.log(b)\n',
        },
      ],
      invalid: [
        {
          name: 'toSorted in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.toSorted()\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'toReversed in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.toReversed()\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'with(...) in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.with(0, 1)\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'findLastIndex in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = a.findLastIndex(x => x)\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'Object.groupBy in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = Object.groupBy(a, x => x)\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'Map.groupBy in a Node-20 package (groupBy is Node-21)',
          filename: 'src/foo.mts',
          packageJson: NODE_20,
          code: 'const b = Map.groupBy(a, x => x)\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'Promise.withResolvers in a Node-21 package (it is Node-22)',
          filename: 'src/foo.mts',
          packageJson: NODE_21,
          code: 'const b = Promise.withResolvers()\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
        {
          name: 'Array.fromAsync in a Node-18 package',
          filename: 'src/foo.mts',
          packageJson: NODE_18,
          code: 'const b = await Array.fromAsync(a)\nconsole.log(b)\n',
          errors: [{ messageId: 'belowEngineFloor' }],
        },
      ],
    })
  })
})
