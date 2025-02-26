// This calls all the CLI commands with --dry-run and asserts the result
// Create one section for every (sub)command with the same pattern.
// Can't do this in a loop due to inline snapshots but that's ok
// Each test covers
// - the stdout/stderr output (should be consistent and repeatable)
// - the exit code (0 for dry-run, 2 for input error)
// - whether the flag-less command name appears in the header in full
// The only exception currently is `cdxgen`
// Regenerate: `npm run build ; npm run test:unit -- test/dry-run.test.ts -u`

import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { envAsBoolean } from '@socketsecurity/registry/lib/env'

import constants from '../dist/constants.js'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

const { CLI, abortSignal } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

const spawnOpts: PromiseSpawnOptions = {
  cwd: npmFixturesPath,
  signal: abortSignal
}

/**
 * This is a simple template wrapper for this pattern:
 * `it('should do: socket scan', (['socket', 'scan']) => {})`
 */
function cmdit(
  cmd: Array<string>,
  title: string,
  cb: (cmd: Array<string>) => Promise<void>,
  ...opts: any
) {
  it(`${title}: \`${cmd.join(' ')}\``, cb.bind(null, cmd), ...opts)
}

describe('dry-run on all commands', async () => {
  let was: unknown

  beforeAll(() => {
    // Temp: we have to disable the banner by default until we make it work
    //       properly with --json and --markdown, since otherwise the output
    //       would be invalid.
    was = process.env['SOCKET_CLI_SHOW_BANNER']
    process.env['SOCKET_CLI_SHOW_BANNER'] = '1'
  })

  afterAll(() => {
    if (was) {
      process.env['SOCKET_CLI_SHOW_BANNER'] = was as any
    }
  })

  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  async function invoke(...args: Array<string>): Promise<{
    status: boolean
    code: number
    stdout: Buffer
    stderr: Buffer
  }> {
    try {
      const thing = await spawn(
        // Lazily access constants.execPath.
        constants.execPath,
        [entryPath, ...args],
        spawnOpts
      )
      return {
        status: true,
        code: 0,
        stdout: toAsciiSafeString(thing.stdout),
        stderr: toAsciiSafeString(thing.stderr)
      }
    } catch (e) {
      return {
        status: false,
        code: e.code,
        stdout: toAsciiSafeString(e.stdout),
        stderr: toAsciiSafeString(e.stderr)
      }
    }
  }

  cmdit(['--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>

      [DryRun]: noop, call a sub-command; ok"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['analytics', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket analytics\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['audit-log', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket audit-log\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

          - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['cdxgen', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket cdxgen\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`"Unknown argument: --dry-run"`)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['dependencies', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket dependencies\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['diff-scan', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan\`, cwd: <redacted>

      [DryRun]: noop, call a sub-command; ok"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['diff-scan', 'get', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan get\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Specify a before and after full scan ID \\x1b[31m(missing before and after!)\\x1b[39m

                - To get full scans IDs, you can run the command "socket scan list <your org slug>".
            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m
      }"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['fix', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['info', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket info\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Expecting a package name \\x1b[31m(missing!)\\x1b[39m

            - Can only accept one package at a time \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['login', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket login\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['logout', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket logout\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest\`, cwd: <redacted>

      [DryRun]: noop, call a sub-command; ok"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'auto', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest auto\`, cwd: <redacted>


        Auto-detect build and attempt to generate manifest file

        $ socket manifest auto

        Unfortunately this script did not discover a supported language in the
        current folder.

        - Make sure this script would work with your target build
        - Make sure to run it from the correct folder
        - Make sure the necessary build tools are available (\`PATH\`)

        If that doesn't work, see \`socket manifest <lang> --help\` for config details for
        your target language."
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'gradle', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest gradle\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - The DIR arg is required \\x1b[31m(missing!)\\x1b[39m

            - Can only accept one DIR (make sure to escape spaces!) \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'kotlin', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - The DIR arg is required \\x1b[31m(missing!)\\x1b[39m

            - Can only accept one DIR (make sure to escape spaces!) \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'scala', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - The DIR or FILE arg is required \\x1b[31m(missing!)\\x1b[39m

            - Can only accept one DIR or FILE (make sure to escape spaces!) \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['npm', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket npm\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['npx', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket npx\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['oops', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket oops\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['optimize', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['raw-npm', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket raw-npm\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['raw-npx', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket raw-npx\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['report', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket report\`, cwd: <redacted>

      [DryRun]: noop, call a sub-command; ok"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['report', 'create', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket report create\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['report', 'view', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket report view\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Need at least one report ID \\x1b[31m(missing!)\\x1b[39m

            - Can only handle a single report ID \\x1b[31m(received 0!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos\`, cwd: <redacted>

      [DryRun]: noop, call a sub-command; ok"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'create', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'del', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos del\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Repository name as the second argument \\x1b[31m(missing!)\\x1b[39m

            - At least one TARGET (e.g. \`.\` or \`./package.json\`"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'list', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos list\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - At least one TARGET (e.g. \`.\` or \`./package.json\`"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'update', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos update\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m

            - At least one TARGET (e.g. \`.\` or \`./package.json\`"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'view', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos view\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan\`, cwd: <redacted>

      [DryRun]: noop, call a sub-command; ok"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'create', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'del', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan del\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Full Scan ID to delete as second argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'list', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

          - Org name as the argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'metadata', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan metadata\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Full Scan ID to inspect as second argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'stream', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan stream\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

            - Full Scan ID to fetch as second argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['threat-feed', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>

      [DryRun] Bailing now"
    `)
    expect(stderr).toMatchInlineSnapshot(`""`)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['wrapper', '--dry-run'], 'should support', async cmd => {
    const { code, status, stderr, stdout } = await invoke(...cmd)
    expect(`\n   ${stdout}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>"
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required flags:

            - Must use --enabled or --disabled"
    `)

    expect(code).toBe(2)
    expect(stdout, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })
})

function toAsciiSafeString(str) {
  /* eslint-disable-next-line */
  const asciiSafeRegex = /[\u0000-\u0007\u0009\u000b-\u001f\u0080-\uffff]/g
  return str.replace(asciiSafeRegex, m => {
    const code = m.charCodeAt(0)
    if (code < 255) return '\\x' + code.toString(16).padStart(2, '0')
    return '\\u' + code.toString(16).padStart(4, '0')
  })
}
