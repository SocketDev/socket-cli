import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnNpm } from '../../../test/utils.mts'

describe('socket package shallow', async () => {
  const { binCliPath } = constants

  cmdit(
    ['package', 'shallow', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Look up info regarding one or more packages but not their transitives

          Usage
            $ socket package shallow [options] <<ECOSYSTEM> <PKGNAME> [<PKGNAME> ...] | <PURL> [<PURL> ...]>

          API Token Requirements
            - Quota: 100 units
            - Permissions: packages:list

          Options
            --json              Output result as json
            --markdown          Output result as markdown

          Show scoring details for one or more packages purely based on their own package.
          This means that any dependency scores are not reflected by the score. You can
          use the \`socket package score <pkg>\` command to get its full transitive score.

          Only a few ecosystems are supported like npm, pypi, nuget, gem, golang, and maven.

          A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
          This command will automatically prepend "pkg:" when not present.

          If the first arg is an ecosystem, remaining args that are not a purl are
          assumed to be scoped to that ecosystem. The \`pkg:\` prefix is optional.

          Note: if a package cannot be found, it may be too old or perhaps was removed
                before we had the opportunity to process it.

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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package shallow\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 First parameter should be an ecosystem or all args must be purls (bad)
          \\xd7 Expecting at least one package (missing)"
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
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package shallow\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
