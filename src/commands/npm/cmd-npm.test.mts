import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
  NPM,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket npm', async () => {
  const { binCliPath } = constants
  let testCwd: string

  beforeAll(async () => {
    // Create isolated temp directory for test execution to ensure
    // even if --dry-run fails, the main repo is not affected.
    testCwd = path.join(
      tmpdir(),
      `socket-npm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(testCwd, { recursive: true })
    // Create minimal package.json for valid npm context
    await fs.writeFile(
      path.join(testCwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', private: true }),
    )
  })

  afterAll(async () => {
    // Cleanup temp directory
    if (testCwd) {
      const trash = (await import('trash')).default
      await trash(testCwd).catch(() => {})
    }
  })

  cmdit(
    [NPM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "Wraps npm with Socket security scanning

          Usage
            $ socket npm ...

          API Token Requirements
                  - Quota: 100 units
            - Permissions: packages:list

          Note: Everything after "npm" is passed to the npm command.
                Only the \`--dry-run\` and \`--help\` flags are caught here.

          Use \`socket wrapper on\` to alias this command as \`npm\`.

          Examples
            $ socket npm
            $ socket npm install -g cowsay
            $ socket npm exec cowsay"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket npm\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket npm`')
    },
  )

  cmdit(
    [NPM, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "npm <command>

        Usage:

        npm install        install all the dependencies in your project
        npm install <foo>  add the <foo> dependency to your project
        npm test           run this project's tests
        npm run <foo>      run the script named <foo>
        npm <command> -h   quick help on <command>
        npm -l             display usage info for all commands
        npm help <term>    search for help on <term>
        npm help npm       more involved overview

        All commands:

            access, adduser, audit, bugs, cache, ci, completion,
            config, dedupe, deprecate, diff, dist-tag, docs, doctor,
            edit, exec, explain, explore, find-dupes, fund, get, help,
            help-search, init, install, install-ci-test, install-test,
            link, ll, login, logout, ls, org, outdated, owner, pack,
            ping, pkg, prefix, profile, prune, publish, query, rebuild,
            repo, restart, root, run, sbom, search, set, shrinkwrap,
            star, stars, start, stop, team, test, token, undeprecate,
            uninstall, unpublish, unstar, update, version, view, whoami

        Specify configs in the ini-formatted file:
            /Users/jdalton/.npmrc
        or on the command line via: npm <command> --key=value

        More configuration info: npm help config
        Configuration fields: npm help 7 config

        npm@11.6.1 /Users/jdalton/.nvm/versions/node/v24.8.0/lib/node_modules/npm"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket npm\`, cwd: <redacted>

        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'npm without command should exit with code 1').toBe(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      FLAG_SILENT,
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle npm exec with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, { cwd: testCwd })
      // npm exec can exit with 0 or 1 depending on whether the package is cached
      expect(
        code,
        'dry-run exec should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npm exec with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "_______
        < hello >
         -------
                \\   ^__^
                 \\  (oo)\\_______
                    (__)\\       )\\/\\
                        ||----w |
                        ||     ||"
      `)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npm exec with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "_______
        < hello >
         -------
                \\   ^__^
                 \\  (oo)\\_______
                    (__)\\       )\\/\\
                        ||----w |
                        ||     ||"
      `)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npm exec with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "_______
        < hello >
         -------
                \\   ^__^
                 \\  (oo)\\_______
                    (__)\\       )\\/\\
                        ||----w |
                        ||     ||"
      `)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with multiple issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npm exec with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "_______
        < hello >
         -------
                \\   ^__^
                 \\  (oo)\\_______
                    (__)\\       )\\/\\
                        ||----w |
                        ||     ||"
      `)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with --config and multiple issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )
})
