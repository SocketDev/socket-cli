import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNativeTerminalFixture } from '../../lib/native/cli-harness.mts'
import { createTuiApiFixture } from '../../lib/native/tui-api.mts'
import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../../lib/termless/animation.mts'

const binary = process.env['SOCKET_CLI_NATIVE_TEST_BINARY']
if (!binary) {
  throw new Error('Use pnpm test:sea to run native CLI tests')
}

const snapshotDir = path.join(process.cwd(), 'test/snapshots/termless')
const artifactDir =
  process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] ??
  path.join(process.cwd(), 'build/native-test-artifacts')
const tuiEnv: NodeJS.ProcessEnv = {}
let api: Awaited<ReturnType<typeof createTuiApiFixture>>

async function waitFor(terminal, text: string): Promise<void> {
  try {
    await terminal.waitFor(text, 30_000)
  } catch (error) {
    throw new Error(
      `${String(error)}\nTerminal screen:\n${terminal.screen.getText()}\n` +
        `Terminal scrollback:\n${terminal.scrollback.getText()}\n` +
        `Terminal output:\n${terminal.output.getText()}\n` +
        `Terminal exit: ${terminal.exitInfo ?? 'still running'}\n` +
        `API requests: ${JSON.stringify(api?.requests)}`,
    )
  }
}

beforeAll(async () => {
  api = await createTuiApiFixture()
  Object.assign(tuiEnv, {
    SOCKET_CLI_CONFIG: '{}',
    SOCKET_CLI_API_TOKEN: 'sktsec_local-fixture-token',
    SOCKET_CLI_API_BASE_URL: api.baseUrl,
    NODE_EXTRA_CA_CERTS: api.caFile,
    // node-pty sets TERM=xterm-256color; point Blessed at its bundled entry so
    // host terminfo differences cannot change the UI or break capability parsing.
    TERMINFO: api.terminfoDir,
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
    await waitFor(terminal, 'Top 5 alert types')
    await waitFor(terminal, 'Total critical alerts')
    await terminal.waitForStable(250, 10_000)
    expect(terminal.screen.getText()).toContain('Top 5 alert types')
    const checkpoint = await captureCheckpoint(terminal, 'charts')
    terminal.press('q')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 10_000 })
      .toBe('exit=0')
    normalizer.flush()
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'analytics',
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
    await waitFor(terminal, 'Audit Logs for fixture-org')
    await waitFor(terminal, 'fixture@example.invalid')
    await terminal.waitForStable(250, 10_000)
    const checkpoint = await captureCheckpoint(terminal, 'table')
    terminal.press('q')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 10_000 })
      .toBe('exit=0')
    normalizer.flush()
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'audit-log',
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
    await waitFor(terminal, 'Threat feed')
    await waitFor(terminal, 'tui-fixture-package')
    await terminal.waitForStable(250, 10_000)
    const checkpoint = await captureCheckpoint(terminal, 'table')
    terminal.press('q')
    await expect
      .poll(() => terminal.exitInfo, { timeout: 10_000 })
      .toBe('exit=0')
    normalizer.flush()
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'threat-feed',
      snapshotsDir: snapshotDir,
      artifactsDir: artifactDir,
      expectedSequence: ['table'],
    })
  }, 60_000)
})
