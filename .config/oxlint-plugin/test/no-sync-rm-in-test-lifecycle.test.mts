/**
 * @file Unit tests for socket/no-sync-rm-in-test-lifecycle.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-sync-rm-in-test-lifecycle.mts'

describe('socket/no-sync-rm-in-test-lifecycle', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-sync-rm-in-test-lifecycle', rule, {
      valid: [
        {
          name: 'await safeDelete in afterEach — correct',
          code: 'afterEach(async () => { await safeDelete(tmpDir) })\n',
        },
        {
          name: 'safeDeleteSync outside lifecycle — allowed',
          code: 'function cleanup() { safeDeleteSync(tmpDir) }\n',
        },
        {
          name: 'fs.rmSync inside regular function — out of scope for this rule',
          code: 'function teardown() { fs.rmSync(tmpDir) }\n',
        },
        {
          name: 'await safeDelete in afterAll',
          code: 'afterAll(async () => { await safeDelete(tmpDir) })\n',
        },
      ],
      invalid: [
        {
          name: 'safeDeleteSync inside afterEach',
          code: 'afterEach(() => { safeDeleteSync(tmpDir) })\n',
          errors: [{ messageId: 'syncDelete' }],
        },
        {
          name: 'fs.rmSync inside afterAll',
          code: 'afterAll(() => { fs.rmSync(tmpDir, { recursive: true }) })\n',
          errors: [{ messageId: 'syncDelete' }],
        },
        {
          name: 'fs.unlinkSync inside beforeEach',
          code: 'beforeEach(() => { fs.unlinkSync(tmpFile) })\n',
          errors: [{ messageId: 'syncDelete' }],
        },
        {
          name: 'safeDeleteSync inside beforeAll',
          code: 'beforeAll(() => { safeDeleteSync(tmpDir) })\n',
          errors: [{ messageId: 'syncDelete' }],
        },
      ],
    })
  })
})
