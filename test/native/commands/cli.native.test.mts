import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_VERSION,
} from '../../../src/constants.mts'
import {
  captureFlow,
  createNativeTerminalFixture,
} from '../../lib/native/cli-harness.mts'
import { discoverNativeCommandPaths } from '../../lib/native/command-inventory.mts'
import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../../lib/terminal/animation.mts'

const binary = process.env['SOCKET_CLI_NATIVE_TEST_BINARY']
if (!binary) {
  throw new Error('Use pnpm test:native to run native CLI tests')
}

const snapshotDir = path.join(process.cwd(), 'test/native-snapshots')
const artifactDir =
  process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] ??
  path.join(process.cwd(), 'build/native-test-artifacts')
const appVersion = process.env['SOCKET_CLI_NATIVE_TEST_VERSION']
const nodeVersion = process.env['SOCKET_CLI_NATIVE_TEST_NODE_VERSION']
if (!appVersion || !nodeVersion) {
  throw new Error('Native test harness must provide manifest versions')
}

const commandPaths = [
  'analytics',
  'audit-log',
  'ci',
  'cdxgen',
  'config',
  'dependencies',
  'fix',
  'install',
  'json',
  'license',
  'login',
  'logout',
  'manifest',
  'npm',
  'npx',
  'pnpm',
  'oops',
  'optimize',
  'organization',
  'package',
  'patch',
  'raw-npm',
  'raw-npx',
  'repository',
  'scan',
  'security',
  'threat-feed',
  'uninstall',
  'wrapper',
  'yarn',
  'config auto',
  'config get',
  'config list',
  'config set',
  'config unset',
  'install completion',
  'uninstall completion',
  'manifest auto',
  'manifest bazel',
  'manifest cdxgen',
  'manifest conda',
  'manifest dotnet',
  'manifest dynamic-sbom-inference',
  'manifest gradle',
  'manifest kotlin',
  'manifest maven',
  'manifest scala',
  'manifest setup',
  'organization dependencies',
  'organization list',
  'organization quota',
  'organization policy',
  'organization policy security',
  'organization policy license',
  'package score',
  'package shallow',
  'repository create',
  'repository view',
  'repository list',
  'repository del',
  'repository update',
  'scan create',
  'scan del',
  'scan diff',
  'scan github',
  'scan list',
  'scan metadata',
  'scan reach',
  'scan report',
  'scan setup',
  'scan view',
] as const

it('keeps the native help matrix aligned with registered commands', async () => {
  expect([...commandPaths].sort()).toEqual(
    (await discoverNativeCommandPaths()).sort(),
  )
})

for (const commandPath of commandPaths) {
  const args = [...commandPath.split(' '), FLAG_HELP]
  const flow = `socket-help-${commandPath.replaceAll(' ', '-')}`
  it(`captures native help for ${commandPath}`, async () => {
    await captureFlow({
      flow,
      args,
      expectedText: commandPath,
      exitCode: 0,
      cols: 140,
      rows: 200,
    })
  }, 60_000)
}

for (const patchCommand of [
  'apply',
  'rollback',
  'get',
  'scan',
  'list',
  'remove',
  'setup',
  'repair',
]) {
  it(`captures bundled patch help for ${patchCommand}`, async () => {
    await captureFlow({
      flow: `socket-patch-${patchCommand}-help`,
      args: ['patch', patchCommand, FLAG_HELP],
      expectedText: `Usage: socket-patch ${patchCommand}`,
      exitCode: 0,
      cols: 140,
      rows: 200,
    })
  }, 60_000)
}

it('captures bundled socket-patch version', async () => {
  const packageMetadata = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { dependencies: { '@socketsecurity/socket-patch': string } }
  await captureFlow({
    flow: 'socket-patch-version',
    args: ['patch', '--version'],
    expectedText: `socket-patch ${packageMetadata.dependencies['@socketsecurity/socket-patch']}`,
    exitCode: 0,
    rows: 12,
    checkpointName: 'version',
  })
}, 30_000)

describe('native Socket CLI', () => {
  it('reports the version embedded in the SEA manifest', async () => {
    await captureFlow({
      flow: 'socket-version',
      args: [FLAG_VERSION],
      expectedText: appVersion,
      exitCode: 0,
      rows: 12,
      checkpointName: 'version',
    })
  }, 30_000)

  it('prints root help and starts the CLI from the native executable', async () => {
    await captureFlow({
      flow: 'socket-help',
      args: [FLAG_HELP],
      expectedText: 'CLI for Socket.dev',
      exitCode: 0,
      rows: 200,
      cols: 140,
    })
  }, 30_000)

  it('runs a local dry-run command through the native executable', async () => {
    await captureFlow({
      flow: 'socket-manifest-dry-run',
      args: [
        'manifest',
        'auto',
        FLAG_DRY_RUN,
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      expectedText: '[DryRun]',
      exitCode: 0,
      rows: 12,
      checkpointName: 'dry-run',
      env: { SOCKET_CLI_CONFIG: '{"apiToken":"fakeToken"}' },
    })
  }, 30_000)

  it('rejects unsupported cdxgen project types before helper execution', async () => {
    await captureFlow({
      flow: 'socket-cdxgen-unsupported-type',
      args: ['manifest', 'cdxgen', '--type', 'pnpm', FLAG_CONFIG, '{}'],
      expectedText: 'supports only npm projects',
      exitCode: 1,
      rows: 12,
      checkpointName: 'unsupported-type',
      env: {},
    })
  }, 30_000)

  it('captures the scan setup selection and cancellation interaction', async () => {
    const fixture = await createNativeTerminalFixture(24)
    const { cwd, normalizer, terminal } = fixture
    await terminal.spawn([binary!, 'scan', 'setup', FLAG_CONFIG, '{}'], {
      cwd,
      env: { NO_COLOR: '', CI: '1' },
    })
    await terminal.waitFor(
      'Which scan command do you want to configure?',
      30_000,
    )
    await terminal.waitForStable(150, 10_000)
    const menu = await captureCheckpoint(terminal, 'menu')
    terminal.press('ArrowDown')
    await terminal.waitForStable(150, 10_000)
    const github = await captureCheckpoint(terminal, 'github-selected')
    terminal.press('ArrowDown')
    await terminal.waitForStable(150, 10_000)
    terminal.press('Enter')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 30_000 })
      .toBe('exit=0')
    normalizer.flush()
    const canceled = await captureCheckpoint(terminal, 'canceled')
    await expectTerminalAnimation(createRecording([menu, github, canceled]), {
      flow: 'socket-scan-setup',
      snapshotsDir: snapshotDir,
      artifactsDir: artifactDir,
      expectedSequence: ['menu', 'github-selected', 'canceled'],
      durations: [850, 850, 1100],
    })
  }, 60_000)
})
