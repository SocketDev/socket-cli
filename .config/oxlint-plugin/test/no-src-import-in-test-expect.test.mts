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
        {
          name: 'src binding is the system-under-test inside expect() subject',
          filename: 'test/unit/foo.test.mts',
          code: "import { canonicalize } from '../../src/util/canon'\nexpect(canonicalize(input)).toEqual(out)\n",
        },
        {
          name: 'src error class used in .toThrow() (identity matcher)',
          filename: 'test/unit/foo.test.mts',
          code: "import { PurlError } from '../../src/error'\nexpect(() => fromString(x)).toThrow(PurlError)\n",
        },
        {
          name: 'src class used in .toBeInstanceOf() (identity matcher)',
          filename: 'test/unit/foo.test.mts',
          code: "import { Ok } from '../../src/result'\nexpect(r).toBeInstanceOf(Ok)\n",
        },
        {
          name: 'src class .prototype used in .toBe() (identity check)',
          filename: 'test/unit/foo.test.mts',
          code: "import { PackageURL } from '../../src/package-url'\nexpect(Object.getPrototypeOf(p)).toBe(PackageURL.prototype)\n",
        },
      ],
      invalid: [
        {
          name: 'src normalizePath used inside expect().toBe() expected value',
          filename: 'test/unit/dlx/detect.test.mts',
          code: "import { normalizePath } from '../../../src/paths/normalize'\nimport { join } from 'node:path'\nexpect(result.path).toBe(normalizePath(join(dir, 'package.json')))\n",
          errors: [{ messageId: 'srcToolInExpect' }],
        },
        {
          name: 'src tool builds expected value in .toEqual()',
          filename: 'test/unit/foo.test.mts',
          code: "import { canonicalize } from '../../src/util/canon'\nexpect(actual).toEqual(canonicalize(input))\n",
          errors: [{ messageId: 'srcToolInExpect' }],
        },
        {
          name: 'deeper-nested src path still flagged in matcher arg',
          filename: 'test/unit/a/b/c.test.mts',
          code: "import { fmt } from '../../../../src/x/y/fmt'\nexpect(v).toBe(fmt(raw))\n",
          errors: [{ messageId: 'srcToolInExpect' }],
        },
      ],
    })
  })
})
