/**
 * @file Unit tests for socket/no-file-scope-oxlint-disable.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-file-scope-oxlint-disable.mts'

describe('socket/no-file-scope-oxlint-disable', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-file-scope-oxlint-disable', rule, {
      valid: [
        {
          name: 'per-line disable is allowed',
          code:
            '// oxlint-disable-next-line socket/no-console-prefer-logger -- bootstrap log\n' +
            'console.log("hi")\n',
        },
        {
          name: 'no disable directive at all',
          code: 'export const x = 1\n',
        },
        {
          name: 'JSDoc block mentioning the shape is not a directive',
          code:
            '/**\n' +
            ' * Example: `/* oxlint-disable socket/no-console-prefer-logger *\\/`.\n' +
            ' */\n' +
            'export const x = 1\n',
        },
        {
          name: 'plugin-internal rules dir is exempt (lookup-table data)',
          filename: '.config/oxlint-plugin/rules/example.mts',
          code:
            '/* oxlint-disable socket/no-console-prefer-logger */\n' +
            'export const x = 1\n',
        },
      ],
      invalid: [
        {
          name: 'file-scope block disable',
          code:
            '/* oxlint-disable socket/no-console-prefer-logger */\n' +
            'console.log("a")\n',
          errors: [{ messageId: 'fileScopeDisable' }],
        },
        {
          name: 'file-scope line disable',
          code:
            '// oxlint-disable socket/no-console-prefer-logger\n' +
            'console.log("a")\n',
          errors: [{ messageId: 'fileScopeDisable' }],
        },
      ],
    })
  })
})
