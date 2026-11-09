import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  captureFlow,
  createNativeTerminalFixture,
} from '../../lib/native/cli-harness.mts'
import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../../lib/terminal/animation.mts'

const binary = process.env['SOCKET_CLI_NATIVE_TEST_BINARY']

describe('native CLI behavior', () => {
  it('reads an explicit config value', async () => {
    await captureFlow({
      flow: 'behavior-config-get',
      checkpointName: 'output',
      args: ['config', 'get', 'defaultOrg'],
      expectedText: 'native-fixture',
      exitCode: 0,
      env: { SOCKET_CLI_CONFIG: '{"defaultOrg":"native-fixture"}' },
    })
  }, 30_000)

  it('lists an explicit config without persisting it', async () => {
    await captureFlow({
      flow: 'behavior-config-list',
      checkpointName: 'output',
      args: ['config', 'list'],
      expectedText: 'native-fixture',
      exitCode: 0,
      rows: 30,
      env: { SOCKET_CLI_CONFIG: '{"defaultOrg":"native-fixture"}' },
    })
  }, 30_000)

  it('rejects an unknown config key', async () => {
    await captureFlow({
      flow: 'behavior-config-invalid-key',
      checkpointName: 'output',
      args: ['config', 'get', 'invalid-native-key'],
      expectedText: 'invalid config key',
      exitCode: 2,
    })
  }, 30_000)

  it('shows a missing socket.json error in an isolated directory', async () => {
    await captureFlow({
      flow: 'behavior-json-missing',
      checkpointName: 'output',
      args: ['json'],
      expectedText: 'Not found:',
      exitCode: 1,
    })
  }, 30_000)

  it('prints a seeded socket.json fixture', async () => {
    await captureFlow({
      flow: 'behavior-json-seeded',
      checkpointName: 'output',
      args: ['json'],
      expectedText: '"projectIgnorePaths"',
      exitCode: 0,
      prepare: async ({ cwd }) => {
        await writeFile(
          `${cwd}/socket.json`,
          '{"version":1,"projectIgnorePaths":["fixture/**"]}\n',
        )
      },
    })
  }, 30_000)

  it('validates wrapper mode before applying the dry-run guard', async () => {
    await captureFlow({
      flow: 'behavior-wrapper-on-dry-run',
      checkpointName: 'output',
      args: ['wrapper', 'on', '--dry-run'],
      expectedText: '[DryRun]',
      exitCode: 0,
    })
  }, 30_000)

  it('captures the manifest setup menu and cancellation', async () => {
    const fixture = await createNativeTerminalFixture(24)
    await fixture.terminal.spawn([binary!, 'manifest', 'setup'], {
      cwd: fixture.cwd,
      env: { NO_COLOR: '', CI: '1', SOCKET_CLI_CONFIG: '{}' },
    })
    await fixture.terminal.waitFor(
      'Select ecosystem manifest generator to configure',
      30_000,
    )
    await fixture.terminal.waitForStable(150, 10_000)
    const menu = await captureCheckpoint(fixture.terminal, 'menu')
    fixture.terminal.press('ArrowUp')
    await fixture.terminal.waitForStable(150, 10_000)
    const selected = await captureCheckpoint(fixture.terminal, 'exit-selected')
    fixture.terminal.press('Enter')
    await fixture.terminal.waitFor('User canceled', 30_000)
    await expect
      .poll(() => fixture.terminal.exitInfo, { timeout: 30_000 })
      .toBe('exit=0')
    fixture.normalizer.flush()
    const canceled = await captureCheckpoint(fixture.terminal, 'canceled')
    await expectTerminalAnimation(createRecording([menu, selected, canceled]), {
      flow: 'behavior-manifest-setup',
      snapshotsDir: path.join(process.cwd(), 'test/native-snapshots'),
      artifactsDir:
        process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] ??
        path.join(process.cwd(), 'build/native-test-artifacts'),
      expectedSequence: ['menu', 'exit-selected', 'canceled'],
      durations: [850, 850, 1100],
    })
  }, 60_000)
})
