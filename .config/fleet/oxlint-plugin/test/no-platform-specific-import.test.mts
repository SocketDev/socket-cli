/**
 * @file Unit tests for socket/no-platform-specific-import.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-platform-specific-import.mts'

describe('socket/no-platform-specific-import', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-platform-specific-import', rule, {
      valid: [
        {
          name: 'import from http-request barrel (no suffix)',
          code: 'import { httpJson } from "../http-request"\n',
        },
        {
          name: 'import from http-request named export path',
          code: 'import { httpJson } from "@socketsecurity/lib/http-request"\n',
        },
        {
          name: 'import from logger barrel (no suffix)',
          code: 'import { getDefaultLogger } from "../logger"\n',
        },
        {
          name: 'import inside http-request module is exempt (node.ts itself)',
          code: 'import { httpJson } from "../http-request/node"\n',
          filename: 'src/http-request/browser.ts',
        },
        {
          name: 'import inside logger module is exempt (browser.ts)',
          code: 'import { logger } from "./node"\n',
          filename: 'src/logger/browser.ts',
        },
        {
          name: 'unrelated node import is fine',
          code: 'import process from "node:process"\n',
        },
        {
          name: 'inline bypass comment allows direct platform import',
          code: '// no-platform-http-import: server-only module\nimport { httpJson } from "../http-request/node"\n',
        },
      ],
      invalid: [
        {
          name: 'direct http-request/node import',
          code: 'import { httpJson } from "../http-request/node"\n',
          errors: [{ messageId: 'platformImport' }],
        },
        {
          name: 'direct http-request/browser import',
          code: 'import { httpJson } from "../http-request/browser"\n',
          errors: [{ messageId: 'platformImport' }],
        },
        {
          name: 'direct logger/node import',
          code: 'import { getDefaultLogger } from "../logger/node"\n',
          errors: [{ messageId: 'platformImport' }],
        },
        {
          name: 'direct logger/browser import',
          code: 'import { logger } from "../logger/browser"\n',
          errors: [{ messageId: 'platformImport' }],
        },
        {
          name: 'package-path http-request/node import',
          code: 'import { httpJson } from "@socketsecurity/lib/http-request/node"\n',
          errors: [{ messageId: 'platformImport' }],
        },
        {
          name: 'autofix rewrites http-request/node to http-request',
          code: 'import { httpJson } from "../http-request/node"\n',
          output: "import { httpJson } from '../http-request'\n",
          errors: [{ messageId: 'platformImport' }],
        },
        {
          name: 'autofix rewrites logger/browser to logger',
          code: 'import { logger } from "../logger/browser"\n',
          output: "import { logger } from '../logger'\n",
          errors: [{ messageId: 'platformImport' }],
        },
      ],
    })
  })
})
