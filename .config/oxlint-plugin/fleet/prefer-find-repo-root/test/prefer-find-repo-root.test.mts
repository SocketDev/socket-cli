/**
 * @file Unit tests for socket/prefer-find-repo-root. The rule flags
 *   `path.join(__dirname, '..', '..'[, '..'])` and similar shapes that try to
 *   reach the repo root by ascent count — fragile under refactors that move the
 *   file deeper or shallower.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-find-repo-root', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-find-repo-root', rule, {
      valid: [
        {
          name: 'single .. is allowed (sibling-of-script lookups)',
          code: 'const fixtures = path.join(__dirname, "..", "fixtures")\n',
        },
        {
          name: 'findRepoRoot call (the canonical form)',
          code: 'const rootPath = findRepoRoot(import.meta)\n',
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
          errors: [{ messageId: 'preferFindRepoRoot' }],
        },
        {
          name: 'path.resolve(__dirname, "..", "..", "..") — three-level',
          code: 'const rootDir = path.resolve(__dirname, "..", "..", "..")\n',
          errors: [{ messageId: 'preferFindRepoRoot' }],
        },
        {
          name: 'trailing segments after ascent still trip the rule',
          code: 'const out = path.join(__dirname, "..", "..", "dist", "foo.js")\n',
          errors: [{ messageId: 'preferFindRepoRoot' }],
        },
        {
          name: 'four-level ascent',
          code: 'const root = path.resolve(__dirname, "..", "..", "..", "..")\n',
          errors: [{ messageId: 'preferFindRepoRoot' }],
        },
      ],
    })
  })
})
