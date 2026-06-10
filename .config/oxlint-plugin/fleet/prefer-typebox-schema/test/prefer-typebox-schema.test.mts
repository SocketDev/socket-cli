/**
 * @file Unit tests for socket/prefer-typebox-schema.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-typebox-schema', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-typebox-schema', rule, {
      valid: [
        {
          name: 'typebox is the blessed schema lib',
          code: "import { Type } from '@sinclair/typebox'\n",
        },
        {
          name: 'unrelated import',
          code: "import path from 'node:path'\n",
        },
        {
          name: 'a package whose name merely starts with a banned word',
          code: "import x from 'zodiac-calendar'\n",
        },
        {
          name: 'commented opt-out',
          code: "// socket-lint: allow schema-lib\nimport { z } from 'zod'\n",
        },
      ],
      invalid: [
        {
          name: 'zod',
          code: "import { z } from 'zod'\n",
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'valibot',
          code: "import * as v from 'valibot'\n",
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'ajv default import',
          code: "import Ajv from 'ajv'\n",
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'ajv subpath',
          code: "import { _ } from 'ajv/dist/core'\n",
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'joi',
          code: "import Joi from 'joi'\n",
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'yup',
          code: "import * as yup from 'yup'\n",
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
