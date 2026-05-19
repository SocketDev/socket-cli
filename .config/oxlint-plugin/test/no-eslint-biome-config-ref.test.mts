/**
 * @file Unit tests for socket/no-eslint-biome-config-ref.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-eslint-biome-config-ref.mts'

describe('socket/no-eslint-biome-config-ref', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-eslint-biome-config-ref', rule, {
      valid: [
        {
          name: 'oxlint reference — allowed',
          code: 'const path = "./oxlintrc.json"\n',
        },
        {
          name: 'unrelated string',
          code: 'const greeting = "hello"\n',
        },
      ],
      invalid: [
        {
          name: '.eslintrc reference',
          code: 'const cfg = ".eslintrc"\n',
          errors: [{ messageId: 'staleConfig', data: { ref: '.eslintrc' } }],
        },
        {
          name: 'biome.json reference',
          code: 'const cfg = "biome.json"\n',
          errors: [{ messageId: 'staleConfig', data: { ref: 'biome.json' } }],
        },
        {
          name: 'eslint package',
          code: 'import x from "eslint-plugin-import"\n',
          errors: [{ messageId: 'staleConfig' }],
        },
        {
          name: '@biomejs/biome package',
          code: 'import x from "@biomejs/biome"\n',
          errors: [{ messageId: 'staleConfig' }],
        },
      ],
    })
  })
})
