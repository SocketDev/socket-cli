/**
 * @file Unit tests for socket/prefer-exists-sync.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

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
          output:
            'import { fileExists } from "./util"\nimport { existsSync } from \'node:fs\'\nif (existsSync("/x")) {}\n',
        },
        {
          name: 'wrapper in a file with its OWN existsSync — reported, NOT autofixed (would collide)',
          code: 'function existsSync(p: string) { return !!p }\nimport { pathExists } from "./util"\nif (pathExists("/x")) {}\n',
          // No fix: rewriting to existsSync() would bind to the local function,
          // and injecting the node:fs import would be a TS2440 collision.
          output:
            'function existsSync(p: string) { return !!p }\nimport { pathExists } from "./util"\nif (pathExists("/x")) {}\n',
          errors: [{ messageId: 'fileExists' }],
        },
      ],
    })
  })
})
