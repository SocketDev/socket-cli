/**
 * @file Unit tests for socket/prefer-find-up-package-json. The rule flags
 *   `path.join(__dirname, '..', '..'[, '..'])` and similar shapes that try to
 *   reach the enclosing package root by ascent count — fragile under refactors
 *   that move the file deeper or shallower.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-find-up-package-json.mts'

describe('socket/prefer-find-up-package-json', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-find-up-package-json', rule, {
      valid: [
        {
          name: 'single .. is allowed (sibling-of-script lookups)',
          code: 'const fixtures = path.join(__dirname, "..", "fixtures")\n',
        },
        {
          name: 'findUpPackageJson call wrapped in path.dirname (canonical form)',
          code: 'const rootPath = path.dirname(findUpPackageJson(import.meta))\n',
        },
        {
          name: 'path.join without __dirname (unrelated)',
          code: 'const out = path.join(rootPath, "dist", "index.js")\n',
        },
        {
          name: 'path.resolve with absolute path (unrelated)',
          code: 'const out = path.resolve("/etc", "passwd")\n',
        },
        {
          name: 'first arg is not literally __dirname',
          code: 'const out = path.join(someDir, "..", "..", "foo")\n',
        },
      ],
      invalid: [
        {
          name: 'path.join(__dirname, "..", "..") — two-level ascent',
          code: 'const rootPath = path.join(__dirname, "..", "..")\n',
          errors: [{ messageId: 'preferFindUpPackageJson' }],
        },
        {
          name: 'path.resolve(__dirname, "..", "..", "..") — three-level',
          code: 'const rootDir = path.resolve(__dirname, "..", "..", "..")\n',
          errors: [{ messageId: 'preferFindUpPackageJson' }],
        },
        {
          name: 'trailing segments after ascent still trip the rule',
          code: 'const out = path.join(__dirname, "..", "..", "dist", "foo.js")\n',
          errors: [{ messageId: 'preferFindUpPackageJson' }],
        },
        {
          name: 'four-level ascent',
          code: 'const root = path.resolve(__dirname, "..", "..", "..", "..")\n',
          errors: [{ messageId: 'preferFindUpPackageJson' }],
        },
      ],
    })
  })
})
