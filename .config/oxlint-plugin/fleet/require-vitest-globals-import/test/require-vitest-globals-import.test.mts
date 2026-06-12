/**
 * @file Unit tests for the require-vitest-globals-import oxlint rule. Flags a
 *   vitest global called in a _.test._ file without importing it from 'vitest'
 *   (fleet vitest is globals:false → un-imported global is undefined at
 *   runtime). Spawns real oxlint via RuleTester; skips when oxlint is absent.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/require-vitest-globals-import', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('require-vitest-globals-import', rule, {
      valid: [
        {
          name: 'all used globals are imported from vitest',
          filename: 'test/unit/a.test.mts',
          code:
            "import { describe, expect, it } from 'vitest'\n" +
            "describe('s', () => { it('x', () => { expect(1).toBe(1) }) })\n",
        },
        {
          name: 'hooks imported + used',
          filename: 'test/unit/a.test.mts',
          code:
            "import { afterAll, beforeAll, expect, test } from 'vitest'\n" +
            "beforeAll(() => {})\nafterAll(() => {})\ntest('x', () => { expect(1).toBe(1) })\n",
        },
        {
          name: 'aliased import (it as t) used under the alias',
          filename: 'test/unit/a.test.mts',
          code:
            "import { it as t, expect } from 'vitest'\n" +
            "t('x', () => { expect(1).toBe(1) })\n",
        },
        {
          name: 'camelCase wrapper imported from a local module (not vitest)',
          filename: 'test/unit/a.test.mts',
          code:
            "import { describeNetworkOnly } from '../util/skip-helpers'\n" +
            "describeNetworkOnly('s', () => {})\n",
        },
        {
          name: 'camelCase wrapper imported AND used as a titled test (itUnixOnly)',
          filename: 'test/unit/a.test.mts',
          code:
            "import { expect, it } from 'vitest'\n" +
            "import { itUnixOnly } from '../util/skip-helpers'\n" +
            "itUnixOnly('x', () => { expect(1).toBe(1) })\n",
        },
        {
          name: 'test<Upper>-named local that is NOT a titled test (createRequire result, string arg)',
          filename: 'test/unit/a.test.mts',
          code:
            "import { createRequire } from 'node:module'\n" +
            'const testRequire = createRequire(import.meta.url)\n' +
            "testRequire('@npmcli/arborist')\n",
        },
        {
          name: 'test<Upper>-named local var member access is not a test call',
          filename: 'test/unit/a.test.mts',
          code: "let testServer\ntestServer = { baseUrl: 'x' }\nconst u = testServer.baseUrl\n",
        },
        {
          name: 'node:test file — globals concept does not apply, stand down',
          filename: 'test/unit/a.test.mts',
          code:
            "import { describe, it } from 'node:test'\n" +
            "describe('s', () => { it('x', () => {}) })\n",
        },
        {
          name: 'NOT a test file — rule does not apply',
          filename: 'src/a.ts',
          code: "describe('s', () => { it('x', () => {}) })\n",
        },
        {
          name: 'no vitest globals used at all',
          filename: 'test/unit/a.test.mts',
          code: "import { foo } from '../src/foo.mts'\nfoo()\n",
        },
      ],
      invalid: [
        {
          name: 'describe used without importing it',
          filename: 'test/unit/a.test.mts',
          code: "describe('s', () => {})\n",
          errors: [{ messageId: 'missingImport' }],
        },
        {
          name: 'it + expect used, neither imported (reported per distinct name)',
          filename: 'test/unit/a.test.mts',
          code: "it('x', () => { expect(1).toBe(1) })\n",
          errors: [
            { messageId: 'missingImport' },
            { messageId: 'missingImport' },
          ],
        },
        {
          name: 'beforeAll used without import',
          filename: 'test/unit/a.test.mts',
          code:
            "import { describe, it, expect } from 'vitest'\n" +
            "beforeAll(() => {})\ndescribe('s', () => { it('x', () => { expect(1).toBe(1) }) })\n",
          errors: [{ messageId: 'missingImport' }],
        },
        {
          name: 'same missing global used twice is reported once',
          filename: 'test/unit/a.test.mts',
          code: "describe('a', () => {})\ndescribe('b', () => {})\n",
          errors: [{ messageId: 'missingImport' }],
        },
        {
          name: 'partial import — test imported but expect is not',
          filename: 'test/unit/a.test.mts',
          code:
            "import { test } from 'vitest'\n" +
            "test('x', () => { expect(1).toBe(1) })\n",
          errors: [{ messageId: 'missingImport' }],
        },
      ],
    })
  })
})
