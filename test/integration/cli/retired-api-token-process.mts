import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { retiredSocketApiTokenFixture } from '../../helpers/retired-socket-api-token.mts'
import { queryApiSafeText } from '../../../src/util/socket/api-query.mts'
import {
  getDefaultApiToken,
  resolveSdkCredential,
  setupSdk,
} from '../../../src/util/socket/sdk.mts'

type AuthResult = {
  cause?: string | undefined
  message?: string | undefined
  ok: boolean
}

type ProcessReport = {
  basicAuthorization?: boolean | undefined
  code?: string | undefined
  ok: boolean
  requests: number
  retiredFailure?: boolean | undefined
  unchangedSettings: boolean
}

type Capture = {
  close: () => Promise<void>
  expectedBasicAuthorization: () => boolean
  requests: () => number
}

const syntheticApiToken = 'sktsec_abc123abc123abc123abc123'

const dataHome = process.env['XDG_DATA_HOME']
if (!dataHome) {
  throw new Error('XDG_DATA_HOME is required for the isolated process')
}
const settingsPath = path.join(dataHome, 'socket', 'settings', 'config.json')
const scenario = process.argv[2]
const logger = getDefaultLogger()

function writeSettings(apiToken: string): Buffer {
  mkdirSync(path.dirname(settingsPath), { recursive: true })
  const contents = Buffer.from(JSON.stringify({ apiToken })).toString('base64')
  writeFileSync(settingsPath, contents)
  return Buffer.from(contents)
}

function report(value: ProcessReport): void {
  logger.log(JSON.stringify(value))
}

function settingsUnchanged(originalSettings: Buffer): boolean {
  return readFileSync(settingsPath).equals(originalSettings)
}

function isRetiredFailure(result: AuthResult): boolean {
  return (
    !result.ok &&
    result.message === 'Authentication Error' &&
    result.cause?.includes('retired') === true
  )
}

function reportAuthResult(
  result: AuthResult,
  originalSettings: Buffer,
  requests: number,
): void {
  const retiredFailure = isRetiredFailure(result)
  report({
    ok: result.ok,
    code: retiredFailure ? 'SOCKET_RETIRED_API_TOKEN' : undefined,
    retiredFailure,
    unchangedSettings: settingsUnchanged(originalSettings),
    requests,
  })
}

function reportResolverError(error: unknown, originalSettings: Buffer): void {
  const code =
    error instanceof Error && 'code' in error ? String(error.code) : undefined
  report({
    ok: false,
    code,
    retiredFailure: code === 'SOCKET_RETIRED_API_TOKEN',
    unchangedSettings: settingsUnchanged(originalSettings),
    requests: 0,
  })
}

function scenarioToken(): string {
  if (
    scenario === 'environment-retired' ||
    scenario === 'explicit-retired' ||
    scenario === 'synthetic-api'
  ) {
    return syntheticApiToken
  }
  if (scenario === 'stored-retired-whitespace') {
    return ` \t${retiredSocketApiTokenFixture}\n `
  }
  if (scenario === 'no-credentials') {
    return ''
  }
  return retiredSocketApiTokenFixture
}

async function startCaptureServer(): Promise<Capture> {
  const expectedAuthorization = `Basic ${Buffer.from(
    `${syntheticApiToken}:`,
  ).toString('base64')}`
  let requests = 0
  let expectedBasicAuthorization = false
  const server = createServer((request, response) => {
    requests += 1
    expectedBasicAuthorization =
      request.headers.authorization === expectedAuthorization
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"organizations":{}}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Local capture server did not start')
  }
  process.env['SOCKET_CLI_API_BASE_URL'] =
    `http://127.0.0.1:${address.port}/v0/`
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      }),
    expectedBasicAuthorization: () => expectedBasicAuthorization,
    requests: () => requests,
  }
}

async function runSetupSdk(
  originalSettings: Buffer,
  capture: Capture,
): Promise<void> {
  const result = await setupSdk()
  reportAuthResult(result, originalSettings, capture.requests())
}

async function runExplicitRetired(originalSettings: Buffer): Promise<void> {
  const result = await resolveSdkCredential({
    apiToken: retiredSocketApiTokenFixture,
  })
  reportAuthResult(result, originalSettings, 0)
}

async function runApiScenario(
  originalSettings: Buffer,
  capture: Capture,
): Promise<void> {
  if (scenario === 'retired-query') {
    const result = await queryApiSafeText('organizations')
    reportAuthResult(result, originalSettings, capture.requests())
    return
  }
  const setupResult = await setupSdk()
  if (!setupResult.ok) {
    reportAuthResult(setupResult, originalSettings, capture.requests())
    return
  }
  await setupResult.data.listOrganizations()
  report({
    ok: true,
    unchangedSettings: settingsUnchanged(originalSettings),
    requests: capture.requests(),
    basicAuthorization: capture.expectedBasicAuthorization(),
  })
}

async function runResolverScenario(originalSettings: Buffer): Promise<void> {
  if (scenario === 'no-credentials' || scenario === 'no-token') {
    const result = await resolveSdkCredential({})
    report({
      ok: result.ok && result.data === undefined,
      unchangedSettings: settingsUnchanged(originalSettings),
      requests: 0,
    })
    return
  }
  try {
    const token = getDefaultApiToken()
    report({
      ok:
        scenario === 'environment-synthetic'
          ? token === syntheticApiToken
          : token !== undefined,
      unchangedSettings: settingsUnchanged(originalSettings),
      requests: 0,
    })
  } catch (error) {
    reportResolverError(error, originalSettings)
  }
}

async function main(): Promise<void> {
  const originalSettings = writeSettings(scenarioToken())
  const usesCaptureServer =
    scenario === 'retired-query' ||
    scenario === 'setup-sdk' ||
    scenario === 'synthetic-api'
  const capture = usesCaptureServer ? await startCaptureServer() : undefined
  try {
    if (scenario === 'setup-sdk' && capture) {
      await runSetupSdk(originalSettings, capture)
    } else if (scenario === 'explicit-retired') {
      await runExplicitRetired(originalSettings)
    } else if (capture) {
      await runApiScenario(originalSettings, capture)
    } else {
      await runResolverScenario(originalSettings)
    }
  } finally {
    await capture?.close()
  }
}

void main().catch(() => {
  process.exitCode = 1
})
