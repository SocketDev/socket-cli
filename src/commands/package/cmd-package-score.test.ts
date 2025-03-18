import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket package score', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['package', 'score', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "Look up info regarding a package

        Usage
          $ socket package score <<ecosystem> <name> [<name> ...] | <purl> [<purl> ...]>

        Options
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --help            Print this help.
          --json            Output result as json
          --markdown        Output result as markdown

        Show scoring details for one or more packages.
        Only a few ecosystems are supported like npm, golang, and maven.

        If the first arg is an ecosystem, remaining args that are not a "purl" are
        assumed to be scoped in that ecosystem. If the first arg is in "purl" form
        then all args must be in purl form ("package url": \`pkg:eco/name@version\`).

        This command takes 100 quota units.
        This command requires \`packages:list\` scope access on your API token.

        Examples
          $ socket package score npm webtorrent
          $ socket package score npm webtorrent@1.9.1
          $ socket package score npm/webtorrent@1.9.1
          $ socket package score maven webtorrent babel
          $ socket package score npm/webtorrent golang/babel
          $ socket package score npm npm/webtorrent@1.0.1 babel"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket package score`'
    )
  })

  cmdit(
    ['package', 'score', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

              - Expecting an ecosystem \\x1b[31m(missing!)\\x1b[39m

              - Expecting at least one package \\x1b[31m(missing!)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    ['package', 'score', 'npm', 'babel', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
