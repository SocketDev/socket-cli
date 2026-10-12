import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn as spawnProcess } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, describe, expect, it } from 'vitest'

import { retiredSocketApiTokenFixture } from '../../helpers/retired-socket-api-token.mts'

type FixtureReport = {
  basicAuthorization?: boolean | undefined
  code?: string | undefined
  ok: boolean
  requests: number
  retiredFailure?: boolean | undefined
  unchangedSettings: boolean
}

type ChildRun = {
  code: number
  outputContainsCredential: boolean
  result: FixtureReport | undefined
  stderrContainsCredential: boolean
}

const processFixturePath = fileURLToPath(
  new URL('./retired-api-token-process.mts', import.meta.url),
)
const cliPath = fileURLToPath(
  new URL('../../../dist/index.js', import.meta.url),
)
const temporaryDirectories: string[] = []
const syntheticApiToken = 'sktsec_abc123abc123abc123abc123'

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await safeDelete(directory)
  }
})

function createTemporaryHome(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'socket-retired-token-'))
  temporaryDirectories.push(directory)
  return directory
}

function createChildEnvironment(
  home: string,
  environment?: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return {
    HOME: home,
    INLINED_COANA_VERSION: '0.0.0',
    INLINED_HOMEPAGE: 'https://socket.dev',
    INLINED_NAME: 'socket',
    INLINED_OPENGREP_VERSION: '0.0.0',
    INLINED_PYCLI_VERSION: '0.0.0',
    INLINED_SOCKET_PATCH_VERSION: '0.0.0',
    INLINED_TRIVY_VERSION: '0.0.0',
    INLINED_TRUFFLEHOG_VERSION: '0.0.0',
    INLINED_VERSION: '0.0.0',
    LOCALAPPDATA: path.join(home, 'data'),
    NODE_NO_WARNINGS: '1',
    PATH: process.env['PATH'] ?? '',
    USERPROFILE: home,
    VITEST: '1',
    XDG_CACHE_HOME: path.join(home, 'data'),
    XDG_DATA_HOME: path.join(home, 'data'),
    SOCKET_CLI_ALLOWED_PRIVATE_HOSTS: '127.0.0.1',
    ...environment,
  }
}

function isOptionalField<T>(
  value: object,
  key: string,
  isExpectedType: (field: unknown) => field is T,
): boolean {
  const field = Object.getOwnPropertyDescriptor(value, key)
  return (
    field === undefined ||
    field.value === undefined ||
    isExpectedType(field.value)
  )
}

function isFixtureReport(value: unknown): value is FixtureReport {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ok' in value) ||
    !('requests' in value) ||
    !('unchangedSettings' in value)
  ) {
    return false
  }
  return (
    typeof value.ok === 'boolean' &&
    typeof value.requests === 'number' &&
    typeof value.unchangedSettings === 'boolean' &&
    isOptionalField(
      value,
      'code',
      (field): field is string => typeof field === 'string',
    ) &&
    isOptionalField(
      value,
      'retiredFailure',
      (field): field is boolean => typeof field === 'boolean',
    ) &&
    isOptionalField(
      value,
      'basicAuthorization',
      (field): field is boolean => typeof field === 'boolean',
    )
  )
}

function parseFixtureReport(output: string): FixtureReport | undefined {
  try {
    const parsed: unknown = JSON.parse(output.trim())
    return isFixtureReport(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function runProcess(
  scenario: string,
  environment?: Record<string, string> | undefined,
): Promise<ChildRun> {
  const home = createTemporaryHome()
  const result = await spawnProcess(
    process.execPath,
    [processFixturePath, scenario],
    {
      cwd: home,
      env: createChildEnvironment(home, environment),
      killTreeOnTimeout: true,
      stdio: 'pipe',
      stdioString: true,
      throws: false,
      timeout: 15_000,
    },
  )
  const output = String(result.stdout)
  const errorOutput = String(result.stderr)
  return {
    code: result.code,
    outputContainsCredential: /\bsktsec_\w+/u.test(output),
    result: parseFixtureReport(output),
    stderrContainsCredential: /\bsktsec_\w+/u.test(errorOutput),
  }
}

function writeRetiredSettings(home: string): void {
  const configDirectory = path.join(home, 'data', 'socket', 'settings')
  mkdirSync(configDirectory, { recursive: true })
  writeFileSync(
    path.join(configDirectory, 'config.json'),
    Buffer.from(
      JSON.stringify({ apiToken: retiredSocketApiTokenFixture }),
    ).toString('base64'),
  )
}

describe('retired Socket API token rejection', () => {
  it('rejects stored, whitespace-normalized, and environment-selected values', async () => {
    const stored = await runProcess('stored-retired')
    expect(stored).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: {
        ok: false,
        code: 'SOCKET_RETIRED_API_TOKEN',
        unchangedSettings: true,
        requests: 0,
      },
    })
    const padded = await runProcess('stored-retired-whitespace')
    expect(padded).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: { ok: false, code: 'SOCKET_RETIRED_API_TOKEN' },
    })
    const environment = await runProcess('environment-retired', {
      SOCKET_CLI_API_TOKEN: retiredSocketApiTokenFixture,
    })
    expect(environment).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: {
        ok: false,
        code: 'SOCKET_RETIRED_API_TOKEN',
        unchangedSettings: true,
        requests: 0,
      },
    })
  })

  it('preserves valid environment precedence and explicit no-token behavior', async () => {
    const validEnvironment = await runProcess('environment-synthetic', {
      SOCKET_CLI_API_TOKEN: syntheticApiToken,
    })
    expect(validEnvironment).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: { ok: true, unchangedSettings: true, requests: 0 },
    })
    const noToken = await runProcess('no-token', {
      SOCKET_CLI_NO_API_TOKEN: 'true',
    })
    expect(noToken).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: { ok: true, unchangedSettings: true, requests: 0 },
    })
    const noCredentials = await runProcess('no-credentials')
    expect(noCredentials).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: { ok: true, unchangedSettings: true, requests: 0 },
    })
  })

  it('rejects explicit, setup, and raw API paths before requests', async () => {
    const explicit = await runProcess('explicit-retired')
    expect(explicit).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: {
        ok: false,
        code: 'SOCKET_RETIRED_API_TOKEN',
        unchangedSettings: true,
        requests: 0,
      },
    })
    const setup = await runProcess('setup-sdk')
    expect(setup).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: {
        ok: false,
        code: 'SOCKET_RETIRED_API_TOKEN',
        retiredFailure: true,
        unchangedSettings: true,
        requests: 0,
      },
    })
    const rawApi = await runProcess('retired-query')
    expect(rawApi).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: {
        ok: false,
        code: 'SOCKET_RETIRED_API_TOKEN',
        retiredFailure: true,
        unchangedSettings: true,
        requests: 0,
      },
    })
  })

  it('keeps the real SDK request on synthetic Basic auth', async () => {
    const result = await runProcess('synthetic-api')
    expect(result).toMatchObject({
      code: 0,
      outputContainsCredential: false,
      stderrContainsCredential: false,
      result: {
        ok: true,
        unchangedSettings: true,
        requests: 1,
        basicAuthorization: true,
      },
    })
  })

  it('makes whoami report a bounded authentication failure', async () => {
    const home = createTemporaryHome()
    writeRetiredSettings(home)
    const result = await spawnProcess(
      process.execPath,
      [cliPath, 'whoami', '--json'],
      {
        cwd: home,
        env: createChildEnvironment(home),
        killTreeOnTimeout: true,
        stdio: 'pipe',
        stdioString: true,
        throws: false,
        timeout: 15_000,
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.code).not.toBe(0)
    expect(/\bsktsec_\w+/u.test(output)).toBe(false)
    expect(output.toLowerCase().includes('retired')).toBe(true)
  })
})
