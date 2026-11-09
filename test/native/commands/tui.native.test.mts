import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNativeTerminalFixture } from '../../lib/native/cli-harness.mts'
import { createTuiApiFixture } from '../../lib/native/tui-api.mts'
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
const tuiEnv: NodeJS.ProcessEnv = {}
let api: Awaited<ReturnType<typeof createTuiApiFixture>>

beforeAll(async () => {
  api = await createTuiApiFixture()
  Object.assign(tuiEnv, {
    SOCKET_CLI_CONFIG: '{}',
    SOCKET_CLI_API_TOKEN: 'sktsec_local-fixture-token',
    SOCKET_CLI_API_BASE_URL: api.baseUrl,
    NODE_EXTRA_CA_CERTS: api.caFile,
    TERM: 'xterm-256color',
    TZ: 'UTC',
    LC_ALL: 'C',
  })
}, 60_000) // Windows may need longer to generate the fixture certificate.
afterAll(async () => {
  await api?.close()
})

describe('native blessed terminal interfaces', () => {
  it('renders the analytics charts from a local API fixture', async () => {
    const fixture = await createNativeTerminalFixture(34, process.env, 120)
    const { cwd, normalizer, terminal } = fixture
    await terminal.spawn([binary!, 'analytics', 'org', '7'], {
      cwd,
      env: { NO_COLOR: '', CI: '1', ...tuiEnv },
    })
    await terminal.waitFor('Top 5 alert types', 30_000)
    await terminal.waitFor('Total critical alerts', 30_000)
    await terminal.waitForStable(250, 10_000)
    expect(terminal.screen.getText()).toContain('Top 5 alert types')
    const checkpoint = await captureCheckpoint(terminal, 'charts')
    terminal.press('q')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 10_000 })
      .toBe('exit=0')
    normalizer.flush()
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'native-analytics-tui',
      snapshotsDir: snapshotDir,
      artifactsDir: artifactDir,
      expectedSequence: ['charts'],
    })
  }, 60_000)

  it('renders the audit log table from a local API fixture', async () => {
    const fixture = await createNativeTerminalFixture(34, process.env, 120)
    const { cwd, normalizer, terminal } = fixture
    await terminal.spawn([binary!, 'audit-log', '--org', 'fixture-org'], {
      cwd,
      env: { NO_COLOR: '', CI: '1', ...tuiEnv },
    })
    await terminal.waitFor('Audit Logs for fixture-org', 30_000)
    await terminal.waitFor('fixture@example.invalid', 30_000)
    await terminal.waitForStable(250, 10_000)
    const checkpoint = await captureCheckpoint(terminal, 'table')
    terminal.press('q')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 10_000 })
      .toBe('exit=0')
    normalizer.flush()
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'native-audit-log-tui',
      snapshotsDir: snapshotDir,
      artifactsDir: artifactDir,
      expectedSequence: ['table'],
    })
  }, 60_000)

  it('renders the threat feed table from a local API fixture', async () => {
    const fixture = await createNativeTerminalFixture(34, process.env, 120)
    const { cwd, normalizer, terminal } = fixture
    await terminal.spawn(
      [binary!, 'threat-feed', '--org', 'fixture-org', '--filter', 'mal'],
      { cwd, env: { NO_COLOR: '', CI: '1', ...tuiEnv } },
    )
    await terminal.waitFor('Threat feed', 30_000)
    await terminal.waitFor('tui-fixture-package', 30_000)
    await terminal.waitForStable(250, 10_000)
    const checkpoint = await captureCheckpoint(terminal, 'table')
    terminal.press('q')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 10_000 })
      .toBe('exit=0')
    normalizer.flush()
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'native-threat-feed-tui',
      snapshotsDir: snapshotDir,
      artifactsDir: artifactDir,
      expectedSequence: ['table'],
    })
  }, 60_000)
})
