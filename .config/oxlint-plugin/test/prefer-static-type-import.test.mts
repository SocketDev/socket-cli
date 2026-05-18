/**
 * @fileoverview Unit tests for socket/prefer-static-type-import.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-static-type-import.mts'

describe('socket/prefer-static-type-import', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-static-type-import', rule, {
      valid: [
        {
          name: 'static type import',
          code: 'import type { Remap } from "../objects/types"\nexport type Foo = Remap<{ a: 1 }>\n',
        },
        {
          name: 'value import unaffected',
          code: 'import { existsSync } from "node:fs"\nexistsSync("/tmp")\n',
        },
        {
          name: 'typeof import is allowed (namespace shape)',
          code: 'const fs: typeof import("node:fs") = require("node:fs")\n',
        },
      ],
      invalid: [
        {
          name: 'inline import expression with qualifier',
          code: 'export type Foo = { spinner?: import("../spinner/types").Spinner | undefined }\n',
          errors: [{ messageId: 'preferStaticTypeImport' }],
        },
        {
          name: 'inline import expression in type alias',
          code: 'export type Wrap = import("../objects/types").Remap<{ a: 1 }>\n',
          errors: [{ messageId: 'preferStaticTypeImport' }],
        },
        {
          name: 'multiple inline imports fire per occurrence',
          code: 'export type T = { a: import("./a").A; b: import("./b").B }\n',
          errors: [
            { messageId: 'preferStaticTypeImport' },
            { messageId: 'preferStaticTypeImport' },
          ],
        },
      ],
    })
  })
})
