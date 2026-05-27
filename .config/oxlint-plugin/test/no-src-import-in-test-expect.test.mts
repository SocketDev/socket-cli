/**
 * @file Unit tests for the no-src-import-in-test-expect oxlint rule. Spawns the
 *   real oxlint binary against fixture files in a tmp dir (see
 *   lib/rule-tester.mts). The rule only fires in `*.test.*` files, on a binding
 *   imported from a relative `src/` path that is then used inside an
 *   `expect(...)` call. Skips silently when `oxlint` isn't on PATH.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-src-import-in-test-expect.mts'

describe('socket/no-src-import-in-test-expect', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-src-import-in-test-expect', rule, {
      valid: [
        {
          name: 'src import used as system-under-test (not in expect)',
          filename: 'test/unit/foo.test.mts',
          code: "import { doThing } from '../../src/foo'\nconst r = doThing()\nexpect(r).toBe(1)\n",
        },
        {
          name: '-stable tool used inside expect is fine',
          filename: 'test/unit/foo.test.mts',
          code: "import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'\nexpect(x).toBe(normalizePath(p))\n",
        },
        {
          name: 'src import in a NON-test file is not flagged',
          filename: 'src/foo.ts',
          code: "import { normalizePath } from '../paths/normalize'\nexpect(x).toBe(normalizePath(p))\n",
        },
        {
          name: 'src import used outside any expect (helper setup)',
          filename: 'test/unit/foo.test.mts',
          code: "import { normalizePath } from '../../src/paths/normalize'\nconst dir = normalizePath(tmp)\nexpect(dir).toBeDefined()\n",
        },
        {
          name: 'node builtin used in expect is fine (not a src import)',
          filename: 'test/unit/foo.test.mts',
          code: "import { join } from 'node:path'\nexpect(p).toBe(join(a, b))\n",
        },
      ],
      invalid: [
        {
          name: 'src normalizePath used inside expect().toBe()',
          filename: 'test/unit/dlx/detect.test.mts',
          code: "import { normalizePath } from '../../../src/paths/normalize'\nimport { join } from 'node:path'\nexpect(result.path).toBe(normalizePath(join(dir, 'package.json')))\n",
          errors: [{ messageId: 'srcToolInExpect' }],
        },
        {
          name: 'src import used as expect argument directly',
          filename: 'test/unit/foo.test.mts',
          code: "import { canonicalize } from '../../src/util/canon'\nexpect(canonicalize(input)).toEqual(out)\n",
          errors: [{ messageId: 'srcToolInExpect' }],
        },
        {
          name: 'deeper-nested src path still flagged',
          filename: 'test/unit/a/b/c.test.mts',
          code: "import { fmt } from '../../../../src/x/y/fmt'\nexpect(v).toBe(fmt(raw))\n",
          errors: [{ messageId: 'srcToolInExpect' }],
        },
      ],
    })
  })
})
