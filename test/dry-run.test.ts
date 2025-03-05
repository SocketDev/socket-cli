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

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../dist/constants.js'

type TestCollectorOptions = Exclude<Parameters<typeof it>[1], undefined>

const { CLI, abortSignal } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

/**
 * This is a simple template wrapper for this pattern:
 * `it('should do: socket scan', (['socket', 'scan']) => {})`
 */
function cmdit(
  cmd: string[],
  title: string,
  cb: (cmd: string[]) => Promise<void>,
  options?: TestCollectorOptions | undefined
) {
  it(
    `${title}: \`${cmd.join(' ')}\``,
    {
      timeout: 10_000,
      ...options
    },
    cb.bind(null, cmd)
  )
}

async function invoke(
  entryPath: string,
  args: string[]
): Promise<{
  status: boolean
  code: number
  stdout: string
  stderr: string
}> {
  try {
    const thing = await spawn(
      // Lazily access constants.execPath.
      constants.execPath,
      [entryPath, ...args],
      {
        cwd: npmFixturesPath,
        signal: abortSignal
      }
    )
    return {
      status: true,
      code: 0,
      stdout: toAsciiSafeString(normalizeLogSymbols(thing.stdout)),
      stderr: toAsciiSafeString(normalizeLogSymbols(thing.stderr))
    }
  } catch (e) {
    return {
      status: false,
      code: e?.code,
      stdout: toAsciiSafeString(normalizeLogSymbols(e?.stdout ?? '')),
      stderr: toAsciiSafeString(normalizeLogSymbols(e?.stderr ?? ''))
    }
  }
}

function normalizeLogSymbols(str: string): string {
  return str
    .replaceAll('✖️', '×')
    .replaceAll('ℹ', 'i')
    .replaceAll('✔', '√')
    .replaceAll('⚠', '‼')
}

function toAsciiSafeString(str: string): string {
  // eslint-disable-next-line no-control-regex
  const asciiSafeRegex = /[\u0000-\u0007\u0009\u000b-\u001f\u0080-\uffff]/g
  return str.replace(asciiSafeRegex, (m: string) => {
    const code = m.charCodeAt(0)
    return code < 255
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`
  })
}

describe('dry-run on all commands', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `"[DryRun]: No-op, call a sub-command; ok"`
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['analytics', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket analytics\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['audit-log', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket audit-log\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['cdxgen', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(
      `
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket cdxgen\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m Unknown argument: --dry-run"
    `
    )

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['dependencies', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket dependencies\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['diff-scan', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `"[DryRun]: No-op, call a sub-command; ok"`
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['diff-scan', 'get', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan get\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Specify a before and after full scan ID \\x1b[31m(missing before and after!)\\x1b[39m

                - To get full scans IDs, you can run the command "socket scan list <your org slug>".
                  The args are expecting a full \`aaa0aa0a-aaaa-0000-0a0a-0000000a00a0\` ID.

            - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['fix', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['info', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket info\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

            - Expecting a package name \\x1b[31m(missing!)\\x1b[39m

            - Can only accept one package at a time \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['login', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket login\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['logout', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket logout\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `"[DryRun]: No-op, call a sub-command; ok"`
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'auto', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`
      "Auto-detect build and attempt to generate manifest file

        $ socket manifest auto

        Unfortunately this script did not discover a supported language in the
        current folder.

        - Make sure this script would work with your target build
        - Make sure to run it from the correct folder
        - Make sure the necessary build tools are available (\`PATH\`)

        If that doesn't work, see \`socket manifest <lang> --help\` for config details for
        your target language."
    `)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest auto\`, cwd: <redacted>"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'gradle', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest gradle\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - The DIR arg is required \\x1b[31m(missing!)\\x1b[39m

      - Can only accept one DIR (make sure to escape spaces!) \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'kotlin', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - The DIR arg is required \\x1b[31m(missing!)\\x1b[39m

      - Can only accept one DIR (make sure to escape spaces!) \\x1b[32m(ok)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['manifest', 'scala', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
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

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['npm', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket npm\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['npx', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket npx\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['oops', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket oops\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['optimize', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['organization', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket organizations\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['raw-npm', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket raw-npm\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['raw-npx', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket raw-npx\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['report', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `"[DryRun]: No-op, call a sub-command; ok"`
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket report\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['report', 'create', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket report create\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['report', 'view', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket report view\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Need at least one report ID \\x1b[31m(missing!)\\x1b[39m

      - Can only handle a single report ID \\x1b[31m(received 0!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `"[DryRun]: No-op, call a sub-command; ok"`
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'create', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'del', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos del\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Repository name as the second argument \\x1b[31m(missing!)\\x1b[39m

      - At least one TARGET (e.g. \`.\` or \`./package.json\`"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'list', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos list\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - At least one TARGET (e.g. \`.\` or \`./package.json\`"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'update', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos update\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m

      - At least one TARGET (e.g. \`.\` or \`./package.json\`"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['repos', 'view', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos view\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  // cmdit(['scan', '--dry-run'], 'should support', async cmd => {
  //   const { code, stderr, stdout } = await invoke(entryPath, cmd)
  //   expect(stdout).toMatchInlineSnapshot(`
  //     "
  //        _____         _       _        /---------------
  //       |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
  //       |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
  //       |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan\`, cwd: <redacted>

  //     [DryRun]: noop, call a sub-command; ok"
  //   `)
  //   expect(`\n   ${stderr}`).toMatchInlineSnapshot(`""`)

  //   expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
  //   expect(stderr, 'header should include command (without params)').toContain(
  //     cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
  //   )
  // })

  // cmdit(['scan', 'create', '--dry-run'], 'should support', async cmd => {
  //   const { code, stderr, stdout } = await invoke(entryPath, cmd)
  //   expect(stdout).toMatchInlineSnapshot(`
  //     "
  //        _____         _       _        /---------------
  //       |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
  //       |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
  //       |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>

  //     [DryRun] Bailing now"
  //   `)
  //   expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
  //     "\\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

  //           - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

  //           - Repository name using --repo \\x1b[31m(missing!)\\x1b[39m

  //           - Branch name using --branch \\x1b[31m(missing!)\\x1b[39m

  //           - At least one TARGET (e.g. \`.\` or \`./package.json\`) (missing)

  //           (Additionally, no API Token was set so we cannot auto-discover these details)"
  //   `)

  //   expect(code).toBe(2)
  //   expect(stderr, 'header should include command (without params)').toContain(
  //     cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
  //   )
  // })

  cmdit(['scan', 'del', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan del\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Full Scan ID to delete as second argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'list', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'metadata', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan metadata\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Full Scan ID to inspect as second argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['scan', 'view', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan view\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

      - Full Scan ID to fetch as second argument \\x1b[31m(missing!)\\x1b[39m"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['threat-feed', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
    `)

    expect(code, 'dry-run should exit with code 0 if input is ok').toBe(0)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })

  cmdit(['wrapper', '--dry-run'], 'should support', async cmd => {
    const { code, stderr, stdout } = await invoke(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(`""`)
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required flags:

      - Must use --enabled or --disabled"
    `)

    expect(code).toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      cmd.slice(0, cmd.indexOf('--dry-run')).join(' ')
    )
  })
})
