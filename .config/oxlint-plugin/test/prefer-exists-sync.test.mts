/**
 * @fileoverview Unit tests for socket/prefer-exists-sync.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-exists-sync.mts'

describe('socket/prefer-exists-sync', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-exists-sync', rule, {
      valid: [
        {
          name: 'existsSync from node:fs',
          code: 'import { existsSync } from "node:fs"\nif (existsSync("/x")) {}\n',
        },
        {
          name: 'stat for metadata (with explanatory comment)',
          code: 'import { statSync } from "node:fs"\nconst s = statSync("/x") // need size\nconsole.log(s.size)\n',
        },
      ],
      invalid: [
        {
          name: 'fs.access for existence check',
          code: 'import { promises as fs } from "node:fs"\nawait fs.access("/x")\n',
          errors: [{ messageId: 'access' }],
        },
        {
          name: 'fileExists wrapper',
          code: 'import { fileExists } from "./util"\nif (fileExists("/x")) {}\n',
          errors: [{ messageId: 'fileExists' }],
        },
      ],
    })
  })
})
