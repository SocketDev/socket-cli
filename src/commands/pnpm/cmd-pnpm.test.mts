import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteAsync } from 'del'
import { afterAll, beforeAll, describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  PNPM,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket pnpm', async () => {
  const { binCliPath } = constants
  let testCwd: string

  beforeAll(async () => {
    testCwd = path.join(
      tmpdir(),
      `socket-pnpm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(testCwd, { recursive: true })
    await fs.writeFile(
      path.join(testCwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', private: true }),
    )
  })

  afterAll(async () => {
    if (testCwd) {
      await deleteAsync(testCwd).catch(() => {})
    }
  })

  cmdit(
    [PNPM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "Run pnpm with Socket security scanning

          Usage
            $ socket pnpm ...

          Note: Everything after "pnpm" is forwarded to pnpm with Socket security scanning.

          Examples
            $ socket pnpm install
            $ socket pnpm add package-name"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket pnpm`')
    },
  )

  cmdit(
    [PNPM, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "Version 10.17.0 (compiled to binary; bundled Node.js v24.8.0)
        Usage: pnpm [command] [flags]
               pnpm [ -h | --help | -v | --version ]

        Manage your dependencies:
              add                  Installs a package and any packages that it depends
                                   on. By default, any new package is installed as a
                                   prod dependency
              import               Generates a pnpm-lock.yaml from an npm
                                   package-lock.json (or npm-shrinkwrap.json) file
           i, install              Install all dependencies for a project
          it, install-test         Runs a pnpm install followed immediately by a pnpm
                                   test
          ln, link                 Connect the local project to another one
              prune                Removes extraneous packages
          rb, rebuild              Rebuild a package
          rm, remove               Removes packages from node_modules and from the
                                   project's package.json
              unlink               Unlinks a package. Like yarn unlink but pnpm
                                   re-installs the dependency after removing the
                                   external link
          up, update               Updates packages to their latest version based on the
                                   specified range

        Review your dependencies:
              audit                Checks for known security issues with the installed
                                   packages
              licenses             Check licenses in consumed packages
          ls, list                 Print all the versions of packages that are
                                   installed, as well as their dependencies, in a
                                   tree-structure
              outdated             Check for outdated packages

        Run your scripts:
              exec                 Executes a shell command in scope of a project
              run                  Runs a defined package script
              start                Runs an arbitrary command specified in the package's
                                   "start" property of its "scripts" object
           t, test                 Runs a package's "test" script, if one was provided

        Other:
              cat-file             Prints the contents of a file based on the hash value
                                   stored in the index file
              cat-index            Prints the index file of a specific package from the
                                   store
              find-hash            Experimental! Lists the packages that include the
                                   file with the specified hash.
              pack                 Create a tarball from a package
              publish              Publishes a package to the registry
              root                 Prints the effective modules directory

        Manage your store:
              store add            Adds new packages to the pnpm store directly. Does
                                   not modify any projects or files outside the store
              store path           Prints the path to the active store directory
              store prune          Removes unreferenced (extraneous, orphan) packages
                                   from the store
              store status         Checks for modified packages in the store

        Options:
          -r, --recursive          Run the command for each project in the workspace."
      `)
      expect(stderr).toContain('CLI')
      expect(code, 'pnpm without args shows help and exits with code 1').toBe(1)
    },
  )

  cmdit(
    [
      PNPM,
      'add',
      'lodash',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    // TODO: Fix test failure - pnpm add with --dry-run flag
    // Test may be failing due to snapshot mismatch or pnpm behavior changes
    'should handle add with --dry-run flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "\\u2009WARN\\u2009 2 deprecated subdependencies found: @sindresorhus/chunkify@2.0.0, boolean@3.2.0
        Already up to date
        Progress: resolved X, reused X, downloaded X, added X, done

        Done in Xs using pnpm v10.17.0"
      `)
      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [PNPM, 'install', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should handle install with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'add',
      '@types/node@^20.0.0',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    // TODO: Fix test failure - pnpm add scoped packages with version
    // Test may be failing due to snapshot mismatch or pnpm behavior changes
    'should handle scoped packages with version',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "\\u2009WARN\\u2009 2 deprecated subdependencies found: @sindresorhus/chunkify@2.0.0, boolean@3.2.0
        Packages: +8 -6
        ++++++++------
        Progress: resolved X, reused X, downloaded X, added X, done
        \\u2009WARN\\u2009 Issues with peer dependencies found
        .
        \\u251c\\u2500\\u252c vitest 3.2.4
        \\u2502 \\u251c\\u2500\\u2500 \\u2715 unmet peer @types/node@24.6.2: found 20.19.19
        \\u2502 \\u2514\\u2500\\u252c vite 7.1.7
        \\u2502   \\u2514\\u2500\\u2500 \\u2715 unmet peer @types/node@24.6.2: found 20.19.19
        \\u2514\\u2500\\u252c knip 5.63.1
          \\u2514\\u2500\\u2500 \\u2715 unmet peer @types/node@24.6.2: found 20.19.19

        devDependencies:
        - @types/node 24.6.2
        + @types/node 20.19.19 (24.7.0 is available) already in devDependencies, was not moved to dependencies.

        Done in Xs using pnpm v10.17.0"
      `)
      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    // TODO: Fix test failure - pnpm install with issueRules for malware
    // Test may be failing due to API mocking or issueRules behavior changes
    'should handle install with issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "\\u2009WARN\\u2009 2 deprecated subdependencies found: @sindresorhus/chunkify@2.0.0, boolean@3.2.0
        Packages: +6 -8
        ++++++--------
        Progress: resolved X, reused X, downloaded X, added X, done
        . prepare$ husky
        . prepare: Done

        devDependencies:
        - @types/node 20.19.19
        + @types/node 24.6.2 (24.7.0 is available)

        Done in Xs using pnpm v10.17.0"
      `)
      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
      FLAG_DRY_RUN,
    ],
    'should handle install with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "Lockfile is up to date, resolution step is skipped
        Already up to date

        . prepare$ husky
        . prepare: Done
        Done in Xs using pnpm v10.17.0"
      `)
      expect(
        code,
        'dry-run install with --config should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle install with multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "Lockfile is up to date, resolution step is skipped
        Already up to date

        . prepare$ husky
        . prepare: Done
        Done in Xs using pnpm v10.17.0"
      `)
      expect(
        code,
        'dry-run install with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
      FLAG_DRY_RUN,
    ],
    'should handle install with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "Lockfile is up to date, resolution step is skipped
        Already up to date

        . prepare$ husky
        . prepare: Done
        Done in Xs using pnpm v10.17.0"
      `)
      expect(
        code,
        'dry-run install with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )
})
