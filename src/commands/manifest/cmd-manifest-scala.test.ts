import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket manifest scala', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['manifest', 'scala', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "[beta] Generate a manifest file (\`pom.xml\`) from Scala's \`build.sbt\` file

        Usage
          $ socket manifest scala [--sbt=path/to/sbt/binary] [--out=path/to/result] FILE|DIR

        Options
          --bin             Location of sbt binary to use
          --cwd             Set the cwd, defaults to process.cwd()
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --help            Print this help.
          --out             Path of output file; where to store the resulting manifest, see also --stdout
          --sbtOpts         Additional options to pass on to sbt, as per \`sbt --help\`
          --stdout          Print resulting pom.xml to stdout (supersedes --out)
          --verbose         Print debug messages

        Uses \`sbt makePom\` to generate a \`pom.xml\` from your \`build.sbt\` file.
        This xml file is the dependency manifest (like a package.json
        for Node.js or requirements.txt for PyPi), but specifically for Scala.

        There are some caveats with \`build.sbt\` to \`pom.xml\` conversion:

        - the xml is exported as socket.pom.xml as to not confuse existing build tools
          but it will first hit your /target/sbt<version> folder (as a different name)

        - the pom.xml format (standard by Scala) does not support certain sbt features
          - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
          - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

        - it uses your sbt settings and local configuration verbatim

        - it can only export one target per run, so if you have multiple targets like
          development and production, you must run them separately.

        You can optionally configure the path to the \`sbt\` bin to invoke.

        Support is beta. Please report issues or give us feedback on what's missing.

        This is only for SBT. If your Scala setup uses gradle, please see the help
        sections for \`socket manifest gradle\` or \`socket cdxgen\`.

        Examples

          $ socket manifest scala ./build.sbt
          $ socket manifest scala --bin=/usr/bin/sbt ./build.sbt"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket manifest scala`'
    )
  })

  cmdit(
    ['manifest', 'scala', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

        - The DIR or FILE arg is required \\x1b[31m(missing!)\\x1b[39m

        - Can only accept one DIR or FILE (make sure to escape spaces!) \\x1b[32m(ok)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    ['manifest', 'scala', 'mootools', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
