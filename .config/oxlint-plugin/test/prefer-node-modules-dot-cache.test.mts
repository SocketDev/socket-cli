/**
 * @fileoverview Unit tests for socket/prefer-node-modules-dot-cache.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-node-modules-dot-cache.mts'

describe('socket/prefer-node-modules-dot-cache', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-node-modules-dot-cache', rule, {
      valid: [
        {
          name: 'node_modules/.cache path',
          code: 'const cache = "node_modules/.cache/socket-wheelhouse-x.json"\n',
        },
        {
          name: 'path.join with node_modules first',
          code: 'import path from "node:path"\nconst x = path.join("/", "node_modules", ".cache", "foo.json")\n',
        },
      ],
      invalid: [
        {
          name: 'repo-root .cache literal',
          code: 'const cache = ".cache/socket-wheelhouse-x.json"\n',
          errors: [{ messageId: 'pathLiteral' }],
        },
        {
          name: 'path.join with .cache only',
          code: 'import path from "node:path"\nconst x = path.join("/foo", ".cache", "bar.json")\n',
          errors: [{ messageId: 'pathJoin' }],
        },
      ],
    })
  })
})
