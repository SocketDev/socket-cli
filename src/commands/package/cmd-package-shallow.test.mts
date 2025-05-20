import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

const { CLI } = constants

describe('socket package shallow', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['package', 'shallow', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Look up info regarding one or more packages but not their transitives

          Usage
            $ socket package shallow <<ecosystem> <name> [<name> ...] | <purl> [<purl> ...]>

          API Token Requirements
            - Quota: 100 units
            - Permissions: packages:list

          Options
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown

          Show scoring details for one or more packages purely based on their own package.
          This means that any dependency scores are not reflected by the score. You can
          use the \`socket package score <pkg>\` command to get its full transitive score.

          Only a few ecosystems are supported like npm, golang, and maven.

          A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
          This command will automatically prepend "pkg:" when not present.

          If the first arg is an ecosystem, remaining args that are not a purl are
          assumed to be scoped to that ecosystem.

          Examples
            $ socket package shallow npm webtorrent
            $ socket package shallow npm webtorrent@1.9.1
            $ socket package shallow npm/webtorrent@1.9.1
            $ socket package shallow pkg:npm/webtorrent@1.9.1
            $ socket package shallow maven webtorrent babel
            $ socket package shallow npm/webtorrent golang/babel
            $ socket package shallow npm npm/webtorrent@1.0.1 babel"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package shallow\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket package shallow`',
      )
    },
  )

  cmdit(
    ['package', 'shallow', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package shallow\`, cwd: <redacted>

        \\x1b[31m\\u2716\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - First parameter should be an ecosystem or all args must be purls (\\x1b[31mbad\\x1b[39m)

          - Expecting at least one package (\\x1b[31mmissing\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'package',
      'shallow',
      'npm',
      'babel',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package shallow\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
