/**
 * @fileoverview Unit tests for socket/no-console-prefer-logger.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-console-prefer-logger.mts'

describe('socket/no-console-prefer-logger', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-console-prefer-logger', rule, {
      valid: [
        {
          name: 'logger.log with hoisted const',
          code: 'import { getDefaultLogger } from "@socketsecurity/lib-stable/logger"\nconst logger = getDefaultLogger()\nlogger.log("ok")\n',
        },
        {
          name: 'logger.log with exported const (regression: hasLocal must see ExportNamedDeclaration)',
          code: 'export const logger = { log: () => {} }\nlogger.log("ok")\n',
        },
        { name: 'no console at all', code: 'export const x = 1\n' },
      ],
      invalid: [
        {
          name: 'console.log',
          code: 'console.log("nope")\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'console.error',
          code: 'console.error("nope")\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
