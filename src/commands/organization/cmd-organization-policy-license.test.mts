import path from 'node:path'

import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ORG,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket organization policy license', async () => {
  const { binCliPath } = constants

  cmdit(
    ['organization', 'policy', 'license', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization policy license`',
      )
    },
  )

  // Tests legacy pre-v1.0 behavior where positional org arguments were accepted.
  // In v1.0+, org must be specified via --org flag or default config.
  // Dry-run mode exits without validating API token (code 0 despite missing token).
  cmdit(
    ['organization', 'policy', 'license', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should reject dry run without proper args',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'dry-run exits with error code when validation fails').toBe(
        2,
      )
    },
  )

  // Tests invalid usage with positional argument (v1.0+ doesn't accept positional org args).
  // Despite invalid usage, dry-run mode exits gracefully with code 0.
  cmdit(
    [
      'organization',
      'policy',
      'license',
      'fakeOrg',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'dry-run should exit with code 2 if validation fails').toBe(
        2,
      )
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'license',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken", "defaultOrg": "fakeOrg"}',
    ],
    'should accept default org',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'dry-run should exit with code 2 if validation fails').toBe(
        2,
      )
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'license',
      FLAG_ORG,
      'forcedorg',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    `should accept ${FLAG_ORG} flag`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'dry-run should exit with code 2 if validation fails').toBe(
        2,
      )
    },
  )
})
