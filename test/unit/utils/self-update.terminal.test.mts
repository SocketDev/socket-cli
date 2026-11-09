import path from 'node:path'

import { createTerminal } from '@termless/core'
import { createXtermBackend } from '@termless/xtermjs'
import updateNotifier from 'tiny-updater'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { isStandaloneSea } from '../../../src/sea/runtime.mts'
import { runSelfUpdateCheck } from '../../../src/utils/self-update.mts'
import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../../lib/terminal/animation.mts'

const { loggerLog } = vi.hoisted(() => ({ loggerLog: vi.fn() }))

vi.mock('tiny-updater', () => ({
  default: vi.fn(async () => false),
}))

vi.mock('../../../src/sea/runtime.mts', () => ({
  isStandaloneSea: vi.fn(() => false),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: { log: loggerLog },
}))

const snapshotsDir = path.join(process.cwd(), 'test/native-snapshots')
const artifactsDir =
  process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] ??
  path.join(process.cwd(), 'build/native-test-artifacts')

describe('self-update terminal notice screenshot', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('captures mocked update notices at standard and wrapped widths', async () => {
    vi.stubEnv('NO_UPDATE_NOTIFIER', '')
    vi.stubEnv('SOCKET_CLI_FORCE_UPDATE_NOTIFIER', '1')
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    vi.mocked(updateNotifier).mockImplementation(async options => {
      options.logCallback?.('socket', '1.0.0', '1.1.0')
      return true
    })

    await captureNoticeAtWidth(120, 'wide')
    await captureNoticeAtWidth(80, 'standard')
    await captureNoticeAtWidth(32, 'wrapped')
  }, 30_000)

  it('captures a stable command line when the notice is suppressed', async () => {
    vi.stubEnv('NO_UPDATE_NOTIFIER', '1')
    vi.stubEnv('SOCKET_CLI_FORCE_UPDATE_NOTIFIER', '1')
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    vi.mocked(updateNotifier).mockClear()
    vi.mocked(loggerLog).mockReset()

    const terminal = createTerminal({
      cols: 80,
      rows: 6,
      backend: createXtermBackend(),
    })
    onTestFinished(async () => await terminal.close())
    terminal.feed('Socket CLI ready\r\n')
    vi.mocked(loggerLog).mockImplementation((notice: string) => {
      terminal.feed(`${notice}\r\n`)
    })

    await runSelfUpdateCheck()

    expect(updateNotifier).not.toHaveBeenCalled()
    expect(loggerLog).not.toHaveBeenCalled()
    expect(terminal.screen.getText()).toContain('Socket CLI ready')
    expect(terminal.screen.getText()).not.toContain('Update with your favorite')
    expect(terminal.screen.getText()).not.toContain('Socket 1.0.0 → 1.1.0.')
    const checkpoint = await captureCheckpoint(terminal, 'suppressed')
    await expectTerminalAnimation(createRecording([checkpoint]), {
      flow: 'self-update-suppressed',
      snapshotsDir,
      artifactsDir,
      expectedSequence: ['suppressed'],
    })
  }, 30_000)
})

async function captureNoticeAtWidth(cols: number, name: string): Promise<void> {
  const terminal = createTerminal({
    cols,
    rows: 6,
    backend: createXtermBackend(),
  })
  onTestFinished(async () => await terminal.close())
  vi.mocked(loggerLog).mockReset()
  vi.mocked(loggerLog).mockImplementation((notice: string) => {
    terminal.feed(`${notice}\r\n`)
  })
  vi.mocked(updateNotifier).mockClear()
  await runSelfUpdateCheck()
  expect(updateNotifier).toHaveBeenCalledOnce()
  expect(vi.mocked(updateNotifier).mock.calls[0]![0].ttl).toBe(0)
  expect(loggerLog).toHaveBeenCalledExactlyOnceWith(
    'Socket 1.0.0 → 1.1.0. Update with your favorite package manager.',
  )
  expect(terminal.screen.getText()).toContain('Socket 1.0.0 → 1.1.0.')
  const checkpoint = await captureCheckpoint(terminal, name)
  await expectTerminalAnimation(createRecording([checkpoint]), {
    flow: `self-update-notice-${name}`,
    snapshotsDir,
    artifactsDir,
    expectedSequence: [name],
  })
}
