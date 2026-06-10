/**
 * @file Unit tests for socket/no-inline-logger.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-inline-logger', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-inline-logger', rule, {
      valid: [
        {
          name: 'hoisted logger',
          code: 'import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default"\nconst logger = getDefaultLogger()\nlogger.info("ok")\n',
        },
      ],
      invalid: [
        {
          name: 'inline getDefaultLogger().info',
          code: 'import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default"\ngetDefaultLogger().info("x")\n',
          errors: [{ messageId: 'inline' }],
        },
      ],
    })
  })
})
