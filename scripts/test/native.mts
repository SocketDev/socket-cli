import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  persistNativeSigningReceipt,
  prepareNativeTestBinary,
} from './apple-signing.mts'
import { assertSnapshotDependenciesCurrent } from './snapshot-dependencies.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'
import type { SpawnSyncOptions } from 'node:child_process'

type NativeManifest = {
  application: { name: string; version: string }
  target: { triple: string }
  payloads: Array<{ id: string; sha256?: string; version?: string }>
  capabilities: { available: string[] }
}

const ROOT = path.resolve(import.meta.dirname, '../..')
const PACKAGE_PATH = path.join(ROOT, 'package.json')
type PackageMetadata = {
  name: string
  version: string
}
const BUILD_DIR = path.join(ROOT, 'build/sea')
const TRIPLE = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
const BUILT_BINARY = path.join(
  BUILD_DIR,
  `socket-${TRIPLE}${process.platform === 'win32' ? '.exe' : ''}`,
)
const BUILT_MANIFEST = path.join(BUILD_DIR, `socket-${TRIPLE}.manifest.json`)

function run(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): void {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

async function verifyArtifact(
  packageInfo: PackageMetadata,
  binaryPath: string,
  manifestPath: string,
) {
  const [binaryStat, manifestText] = await Promise.all([
    fs.stat(binaryPath),
    fs.readFile(manifestPath, 'utf8'),
  ])
  if (!binaryStat.isFile()) {
    throw new Error(`Native CLI is not a file: ${binaryPath}`)
  }
  if (process.platform !== 'win32' && (binaryStat.mode & 0o111) === 0) {
    throw new Error(`Native CLI is not executable: ${binaryPath}`)
  }
  const manifest = JSON.parse(manifestText) as NativeManifest
  if (
    manifest.application?.name !== packageInfo.name ||
    manifest.application?.version !== packageInfo.version
  ) {
    throw new Error(
      `Native manifest is for ${manifest.application?.name}@${manifest.application?.version}; expected ${packageInfo.name}@${packageInfo.version}`,
    )
  }
  if (manifest.target?.triple !== TRIPLE) {
    throw new Error(
      `Native manifest target ${manifest.target?.triple} does not match host ${TRIPLE}`,
    )
  }
  if (!manifest.capabilities?.available?.includes('socket-core')) {
    throw new Error('Native manifest does not advertise socket-core')
  }
  const executablePayload = manifest.payloads.find(
    payload => payload.id === 'socket-vfs',
  )
  if (!executablePayload?.sha256) {
    throw new Error('Native manifest does not record the executable digest')
  }
  const executableDigest = createHash('sha256')
    .update(await fs.readFile(binaryPath))
    .digest('hex')
  if (executableDigest !== executablePayload.sha256) {
    throw new Error('Native executable digest does not match its manifest')
  }
  return manifest
}

function runPnpm(args: readonly string[], env = process.env): void {
  const pnpmScript = process.env['npm_execpath']
  if (pnpmScript && path.isAbsolute(pnpmScript)) {
    if (/\.[cm]?js$/i.test(pnpmScript)) {
      run(process.execPath, [pnpmScript, ...args], { env })
    } else {
      run(pnpmScript, args, { env })
    }
    return
  }
  run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    ...(process.platform === 'win32' ? { shell: true } : {}),
    env,
  })
}

async function main(): Promise<number> {
  const packageInfo = JSON.parse(
    await fs.readFile(PACKAGE_PATH, 'utf8'),
  ) as PackageMetadata
  const userArgs = process.argv.slice(2)
  const build = userArgs.includes('--build')
  const vitestArgs = userArgs.filter(
    arg => arg !== '--build' && arg !== '--require-apple-signature',
  )
  const updatesSnapshots = vitestArgs.some(
    arg => arg === '-u' || arg === '--update',
  )
  if (
    !updatesSnapshots &&
    vitestArgs.some(arg => arg.endsWith('cli.native.test.mts'))
  ) {
    await assertSnapshotDependenciesCurrent()
  }
  const requireSignature =
    userArgs.includes('--require-apple-signature') ||
    process.env['SOCKET_CLI_NATIVE_TEST_REQUIRE_APPLE_SIGNATURE'] === '1'
  const stageRoot = process.env['RUNNER_TEMP']
    ? path.resolve(process.env['RUNNER_TEMP'])
    : os.tmpdir()
  const stageDir = await fs.mkdtemp(path.join(stageRoot, 'sn-'))
  const artifactsRoot = path.join(ROOT, 'build/native-test-artifacts')
  await fs.mkdir(artifactsRoot, { recursive: true })
  const artifactsDir = process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS']
    ? path.resolve(process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'])
    : await fs.mkdtemp(
        path.join(artifactsRoot, `${process.platform}-${process.arch}-`),
      )
  await fs.mkdir(artifactsDir, { recursive: true })
  const receiptPath = path.join(artifactsDir, 'signing-receipt.json')
  const binaryPath = path.join(
    stageDir,
    `socket-${TRIPLE}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const manifestPath = path.join(stageDir, `socket-${TRIPLE}.manifest.json`)
  const oldEnv = {
    SOCKET_CLI_NATIVE_TEST_BINARY: process.env['SOCKET_CLI_NATIVE_TEST_BINARY'],
    SOCKET_CLI_NATIVE_TEST_STAGE: process.env['SOCKET_CLI_NATIVE_TEST_STAGE'],
    SOCKET_CLI_NATIVE_TEST_CAPABILITIES:
      process.env['SOCKET_CLI_NATIVE_TEST_CAPABILITIES'],
    SOCKET_CLI_NATIVE_TEST_VERSION:
      process.env['SOCKET_CLI_NATIVE_TEST_VERSION'],
    SOCKET_CLI_NATIVE_TEST_NODE_VERSION:
      process.env['SOCKET_CLI_NATIVE_TEST_NODE_VERSION'],
    SOCKET_CLI_NATIVE_TEST_UPDATE_SNAPSHOTS:
      process.env['SOCKET_CLI_NATIVE_TEST_UPDATE_SNAPSHOTS'],
    SOCKET_CLI_NATIVE_TEST_ARTIFACTS:
      process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'],
    SOCKET_CLI_NATIVE_TEST_RECEIPT_PATH:
      process.env['SOCKET_CLI_NATIVE_TEST_RECEIPT_PATH'],
    HOME: process.env['HOME'],
    USERPROFILE: process.env['USERPROFILE'],
    XDG_CACHE_HOME: process.env['XDG_CACHE_HOME'],
    npm_config_cache: process.env['npm_config_cache'],
    npm_config_store_dir: process.env['npm_config_store_dir'],
    PNPM_HOME: process.env['PNPM_HOME'],
    npm_config_cache_dir: process.env['npm_config_cache_dir'],
    npm_config_userconfig: process.env['npm_config_userconfig'],
    npm_config_globalconfig: process.env['npm_config_globalconfig'],
    XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
    XDG_DATA_HOME: process.env['XDG_DATA_HOME'],
    LOCALAPPDATA: process.env['LOCALAPPDATA'],
    APPDATA: process.env['APPDATA'],
    TMPDIR: process.env['TMPDIR'],
    TMP: process.env['TMP'],
    TEMP: process.env['TEMP'],
  }

  try {
    process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] = artifactsDir
    process.env['SOCKET_CLI_NATIVE_TEST_RECEIPT_PATH'] = receiptPath
    if (build) {
      runPnpm(
        ['build:sea', '--', '--prototype'],
        sanitizeNativeEnvironment(process.env),
      )
    }

    // Snapshot the verified artifact into this run's private stage so another
    // build cannot replace the executable after validation.
    await Promise.all([
      fs.copyFile(BUILT_BINARY, binaryPath),
      fs.copyFile(BUILT_MANIFEST, manifestPath),
    ])
    if (process.platform !== 'win32') {
      await fs.chmod(binaryPath, 0o700)
    }
    const manifest = await verifyArtifact(packageInfo, binaryPath, manifestPath)
    const sourceDigest = manifest.payloads.find(
      payload => payload.id === 'socket-vfs',
    )!.sha256!
    const signingEnv = {
      ...process.env,
      ...(requireSignature
        ? { SOCKET_CLI_NATIVE_TEST_REQUIRE_APPLE_SIGNATURE: '1' }
        : {}),
    }
    const receipt = await prepareNativeTestBinary({
      binaryPath,
      sourceSha256: sourceDigest,
      env: signingEnv,
    })
    await persistNativeSigningReceipt(receipt, receiptPath)

    process.env['SOCKET_CLI_NATIVE_TEST_BINARY'] = binaryPath
    process.env['SOCKET_CLI_NATIVE_TEST_STAGE'] = stageDir
    process.env['SOCKET_CLI_NATIVE_TEST_CAPABILITIES'] =
      manifest.capabilities.available.join(',')
    process.env['SOCKET_CLI_NATIVE_TEST_VERSION'] = packageInfo.version
    const nodeRuntime = manifest.payloads.find(
      payload => payload.id === 'node-runtime',
    )
    if (!nodeRuntime?.version) {
      throw new Error(
        'Native manifest does not record the Node runtime version',
      )
    }
    process.env['SOCKET_CLI_NATIVE_TEST_NODE_VERSION'] = nodeRuntime.version
    process.env['SOCKET_CLI_NATIVE_TEST_UPDATE_SNAPSHOTS'] = String(
      updatesSnapshots,
    )
    // Give this run private package-manager caches so npm npx and pnpm dlx
    // never contend with each other or other local/test-runner activity.
    process.env['HOME'] = path.join(stageDir, 'home')
    process.env['USERPROFILE'] = path.join(stageDir, 'home')
    process.env['XDG_CACHE_HOME'] = path.join(stageDir, 'xdg-cache')
    process.env['npm_config_cache'] = path.join(stageDir, 'npm-cache')
    process.env['npm_config_store_dir'] = path.join(stageDir, 'pnpm-store')
    process.env['npm_config_cache_dir'] = path.join(stageDir, 'pnpm-cache')
    process.env['npm_config_userconfig'] = path.join(stageDir, 'npmrc')
    process.env['npm_config_globalconfig'] = path.join(stageDir, 'global-npmrc')
    process.env['PNPM_HOME'] = path.join(stageDir, 'pnpm-home')
    process.env['XDG_CONFIG_HOME'] = path.join(stageDir, 'xdg-config')
    process.env['XDG_DATA_HOME'] = path.join(stageDir, 'xdg-data')
    process.env['LOCALAPPDATA'] = path.join(stageDir, 'AppData', 'Local')
    process.env['APPDATA'] = path.join(stageDir, 'AppData', 'Roaming')
    process.env['TMPDIR'] = path.join(stageDir, 'tmp')
    process.env['TMP'] = path.join(stageDir, 'tmp')
    process.env['TEMP'] = path.join(stageDir, 'tmp')
    await Promise.all(
      [
        'home',
        'xdg-cache',
        'npm-cache',
        'pnpm-store',
        'pnpm-cache',
        'pnpm-home',
        'xdg-config',
        'xdg-data',
        'AppData/Local',
        'AppData/Roaming',
        'tmp',
      ].map(directory =>
        fs.mkdir(path.join(stageDir, directory), { recursive: true }),
      ),
    )
    await Promise.all([
      fs.writeFile(process.env['npm_config_userconfig']!, ''),
      fs.writeFile(process.env['npm_config_globalconfig']!, ''),
    ])
    const childEnv = sanitizeNativeEnvironment(process.env)
    const version = spawnSync(binaryPath, ['--version'], {
      cwd: ROOT,
      env: childEnv,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (version.error) {
      throw version.error
    }
    if (
      version.status !== 0 ||
      !version.stdout.trim().startsWith(packageInfo.version)
    ) {
      throw new Error(
        `Native --version check failed (status ${version.status}): ${version.stdout}${version.stderr}`,
      )
    }
    console.log(`Native test binary: ${binaryPath}`)
    console.log(
      `Native capabilities: ${manifest.capabilities.available.join(', ')}`,
    )
    childEnv['SOCKET_CLI_NATIVE_TEST_SIGNING_RECEIPT'] = JSON.stringify(receipt)
    runPnpm(
      [
        'exec',
        'vitest',
        'run',
        '--config',
        '.config/vitest.native.config.mts',
        ...vitestArgs,
      ],
      childEnv,
    )
    return 0
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    await fs.rm(stageDir, { recursive: true, force: true })
  }
}

function sanitizeNativeEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (
      /^(APPLE_|NPM_TOKEN$|NODE_AUTH_TOKEN$|GITHUB_TOKEN$|GH_TOKEN$|AWS_|AZURE_|GOOGLE_)/i.test(
        key,
      ) ||
      (/^(SOCKET_|SOCKETCLI_)/i.test(key) &&
        !/^SOCKET_CLI_NATIVE_TEST_/.test(key)) ||
      /(^|_)(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|AUTHORIZATION)(_|$)/i.test(
        key,
      )
    ) {
      delete env[key]
    }
  }
  return env
}

const SCRIPT_META: ScriptMeta = {
  describe: 'runs integration tests against the host-native Socket SEA binary',
  help: `Usage: pnpm run test:native [vitest options]
       pnpm run test:native:build [vitest options]

  The native lane requires a matching build/sea/socket-<platform>-<arch> binary
  and manifest. The :build variant creates the prototype first. Native test
  package-manager caches are isolated and test files run serially.

  Pass Vitest options after the script name to filter test files or tests.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
