import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { REDACTED } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { retiredSocketApiTokenFixture } from '../../helpers/retired-socket-api-token.mts'
import { afterEach } from 'vitest'

export type FixtureReport = Record<string, boolean>

export type ChildRun = {
  code: number | null
  signal: NodeJS.Signals | null
  exitDiagnostic: string
  spawnErrorCode: string | undefined
  configFileExists: boolean
  config: Record<string, unknown> | undefined
  home: string
  output: string
  stdout: string
  outputContainsRetiredToken: boolean
  outputContainsSyntheticToken: boolean
  outputHasRetiredGuidance: boolean
  outputHasDryRunPreview: boolean
  outputHasRedaction: boolean
  outputHasNotSavedMessage: boolean
  outputShowsNonSensitiveValue: boolean
}

const processFixturePath = fileURLToPath(
  new URL('./retired-config-write-process.mts', import.meta.url),
)
const sourceResolutionPath = fileURLToPath(
  new URL('./config-source-resolution.mts', import.meta.url),
)
export const factoryFixturePath = fileURLToPath(
  new URL('./config-command-factory-process.mts', import.meta.url),
)
export const cliPath = getBinCliPath()
const temporaryHomes: string[] = []
export const syntheticApiToken = 'sktsec_cli_synthetic_abc123' // socket-test-fake-token

afterEach(async () => {
  for (const home of temporaryHomes.splice(0)) {
    await safeDelete(home)
  }
})

export function createTemporaryHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'socket-config-write-'))
  temporaryHomes.push(home)
  return home
}

export function createChildEnvironment(
  home: string,
  environment?: Record<string, string> | undefined,
  includeHome = true,
): NodeJS.ProcessEnv {
  const dataHome = path.join(home, 'data')
  return {
    ...(includeHome ? { HOME: home } : {}),
    INLINED_COANA_VERSION: '0.0.0',
    INLINED_HOMEPAGE: 'https://socket.dev',
    INLINED_NAME: 'socket',
    INLINED_OPENGREP_VERSION: '0.0.0',
    INLINED_PYCLI_VERSION: '0.0.0',
    INLINED_SOCKET_PATCH_VERSION: '0.0.0',
    INLINED_TRIVY_VERSION: '0.0.0',
    INLINED_TRUFFLEHOG_VERSION: '0.0.0',
    INLINED_VERSION: '0.0.0',
    LOCALAPPDATA: dataHome,
    NODE_NO_WARNINGS: '1',
    PATH: process.env['PATH'] ?? '',
    SOCKET_CLI_SKIP_UPDATE_CHECK: 'true',
    USERPROFILE: home,
    VITEST: '1',
    XDG_CACHE_HOME: path.join(dataHome, 'cache'),
    XDG_DATA_HOME: dataHome,
    ...environment,
  }
}

export function configFilePath(home: string): string {
  return path.join(home, 'data', 'socket', 'settings', 'config.json')
}

export function readPersistedConfig(
  home: string,
): Record<string, unknown> | undefined {
  const configPath = configFilePath(home)
  if (!existsSync(configPath)) {
    return undefined
  }
  try {
    const encodedConfig = readFileSync(configPath, 'utf8')
    const decodedConfig = Buffer.from(encodedConfig, 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(decodedConfig)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function writePersistedConfig(
  home: string,
  config: Record<string, unknown>,
): Buffer {
  const configPath = configFilePath(home)
  mkdirSync(path.dirname(configPath), { recursive: true })
  const bytes = Buffer.from(JSON.stringify(config)).toString('base64')
  writeFileSync(configPath, bytes)
  return readFileSync(configPath)
}

export function readPersistedTokenMatches(
  home: string,
  token: string,
): boolean {
  const configPath = configFilePath(home)
  if (!existsSync(configPath)) {
    return false
  }
  try {
    const encodedConfig = readFileSync(configPath, 'utf8')
    const decodedConfig = Buffer.from(encodedConfig, 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(decodedConfig)
    return (
      isPlainObject(parsed) &&
      'apiToken' in parsed &&
      parsed['apiToken'] === token
    )
  } catch {
    return false
  }
}

function isFixtureReport(value: unknown): value is FixtureReport {
  return (
    isPlainObject(value) &&
    Object.values(value).every(field => typeof field === 'boolean')
  )
}

export async function runChild(
  entryPath: string,
  args: readonly string[],
  environment?: Record<string, string> | undefined,
): Promise<ChildRun> {
  const home = createTemporaryHome()
  return runChildInHome(entryPath, args, home, environment)
}

export async function runChildInHome(
  entryPath: string,
  args: readonly string[],
  home: string,
  environment?: Record<string, string> | undefined,
  includeHome = true,
): Promise<ChildRun> {
  const timeoutMs = 15_000
  const entryArgs =
    entryPath === factoryFixturePath
      ? ['--import', sourceResolutionPath, entryPath, ...args]
      : [entryPath, ...args]
  const child = spawn(process.execPath, entryArgs, {
    cwd: home,
    env: createChildEnvironment(home, environment, includeHome),
    killTreeOnTimeout: true,
    stdio: 'pipe',
    stdioString: true,
    throws: false,
    timeout: timeoutMs,
  })
  let spawnErrorCode: string | undefined
  child.process.once('error', error => {
    const code = Reflect.get(error, 'code')
    spawnErrorCode = typeof code === 'string' ? code : 'unknown'
  })
  const result = await child
  const output = `${result.stdout}\n${result.stderr}`
  const safeStderr = result.stderr
    .replaceAll(retiredSocketApiTokenFixture, () => REDACTED)
    .replaceAll(syntheticApiToken, () => REDACTED)
    .replace(/\bsktsec_[A-Za-z0-9_-]+\b/g, () => REDACTED)
    .slice(0, 2000)
  return {
    code: result.code,
    signal: result.signal,
    exitDiagnostic:
      `exit=${String(result.code)} signal=${result.signal ?? 'none'} ` +
      `childExit=${String(child.process.exitCode)} ` +
      `childSignal=${child.process.signalCode ?? 'none'} ` +
      `killed=${child.process.killed} timeoutMs=${timeoutMs} ` +
      `spawnErrorCode=${spawnErrorCode ?? 'none'} ` +
      `pid=${child.process.pid ?? 'none'} spawnfile=${child.process.spawnfile} ` +
      `argCount=${entryArgs.length} ` +
      `argBytes=${Buffer.byteLength(entryArgs.join(''), 'utf8')} ` +
      `node=${process.version} stderr=${safeStderr}`,
    spawnErrorCode,
    configFileExists: existsSync(configFilePath(home)),
    config: readPersistedConfig(home),
    home,
    output,
    stdout: result.stdout,
    outputContainsRetiredToken: output.includes(retiredSocketApiTokenFixture),
    outputContainsSyntheticToken: output.includes(syntheticApiToken),
    outputHasRetiredGuidance: output.includes(
      'The selected Socket API token is retired.',
    ),
    outputHasDryRunPreview: output.includes('[DryRun]: Would set config value'),
    outputHasRedaction: output.includes(REDACTED),
    outputHasNotSavedMessage: output.includes('was not saved'),
    outputShowsNonSensitiveValue: output.includes('example-org'),
  }
}

export async function runWriterFixture(scenario: 'writer' | 'read-only') {
  const home = createTemporaryHome()
  const result = await spawn(process.execPath, [processFixturePath, scenario], {
    cwd: home,
    env: createChildEnvironment(home),
    killTreeOnTimeout: true,
    stdio: 'pipe',
    stdioString: true,
    throws: false,
    timeout: 15_000,
  })
  const parsed: unknown = JSON.parse(result.stdout.trim())
  if (result.code !== 0 || !isFixtureReport(parsed)) {
    throw new Error('Config writer fixture failed without a safe report')
  }
  return parsed
}
