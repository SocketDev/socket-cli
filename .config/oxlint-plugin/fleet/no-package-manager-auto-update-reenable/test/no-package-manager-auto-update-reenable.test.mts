/**
 * @file Unit tests for socket/no-package-manager-auto-update-reenable.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-package-manager-auto-update-reenable', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-package-manager-auto-update-reenable', rule, {
      valid: [
        {
          name: 'hardened homebrew disable (truthy)',
          code: 'const env = "HOMEBREW_NO_AUTO_UPDATE=1"\n',
        },
        {
          name: 'hardened update-notifier off',
          code: 'const npmrc = "update-notifier=false"\n',
        },
        {
          name: 'hardened choco feature disable',
          code: 'const cmd = "choco feature disable -n autoUpdate"\n',
        },
        {
          name: 'unrelated env var set to 0',
          code: 'const env = "VERBOSE=0"\n',
        },
        {
          name: 'unrelated update-notifier key, not true',
          code: 'const cfg = \'"some-other-flag": true\'\n',
        },
      ],
      invalid: [
        {
          name: 'homebrew re-enable =0',
          code: 'const env = "HOMEBREW_NO_AUTO_UPDATE=0"\n',
          errors: [{ messageId: 'reenabled' }],
        },
        {
          name: 'homebrew re-enable =false',
          code: 'const env = "export HOMEBREW_NO_AUTO_UPDATE=false"\n',
          errors: [{ messageId: 'reenabled' }],
        },
        {
          name: 'deno update-check re-enable',
          code: 'const env = "DENO_NO_UPDATE_CHECK=0"\n',
          errors: [{ messageId: 'reenabled' }],
        },
        {
          name: 'npmrc update-notifier=true',
          code: 'const npmrc = "update-notifier=true"\n',
          errors: [{ messageId: 'reenabled' }],
        },
        {
          name: 'json config update-notifier true',
          code: 'const cfg = \'"update-notifier": true\'\n',
          errors: [{ messageId: 'reenabled' }],
        },
        {
          name: 'choco feature enable -n autoUpdate',
          code: 'const cmd = "choco feature enable -n autoUpdate"\n',
          errors: [{ messageId: 'reenabled' }],
        },
        {
          name: 'choco feature enable -n=autoUpdate',
          code: 'const cmd = "choco feature enable -n=autoUpdate"\n',
          errors: [{ messageId: 'reenabled' }],
        },
      ],
    })
  })
})
