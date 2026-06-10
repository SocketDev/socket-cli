/**
 * @file Unit tests for socket/prefer-shell-win32.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-shell-win32', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-shell-win32', rule, {
      valid: [
        {
          name: 'shell: WIN32 is the canonical fleet pattern',
          code: 'spawn("ls", [], { shell: WIN32 })\n',
        },
        {
          name: 'shell: false is fine (explicit no-shell)',
          code: 'spawn("ls", [], { shell: false })\n',
        },
        {
          name: 'shell as string path is fine',
          code: 'spawn("ls", [], { shell: "/bin/sh" })\n',
        },
        {
          name: 'no shell property at all',
          code: 'spawn("ls", [], { stdio: "inherit" })\n',
        },
        {
          name: 'bypass comment before property',
          code: '// prefer-shell-win32: intentional - need shell on every platform for user expression\nspawn("ls", [], { shell: true })\n',
        },
        {
          name: 'unrelated property named shell on a non-spawn object is not actually flagged either way — bypass via inline comment if needed',
          code: 'const config = { shell: false }\n',
        },
      ],
      invalid: [
        {
          name: 'object literal: shell: true',
          code: 'spawn("ls", [], { shell: true })\n',
          errors: [{ messageId: 'shellTrue' }],
        },
        {
          name: 'quoted key: "shell": true',
          code: 'spawn("ls", [], { "shell": true })\n',
          errors: [{ messageId: 'shellTrue' }],
        },
        {
          name: 'sync spawn call',
          code: 'spawnSync("npm.cmd", ["--version"], { shell: true })\n',
          errors: [{ messageId: 'shellTrue' }],
        },
        {
          name: 'shell: true alongside other props',
          code: 'spawn("ls", [], { cwd: "/tmp", shell: true, stdio: "inherit" })\n',
          errors: [{ messageId: 'shellTrue' }],
        },
      ],
    })
  })
})
