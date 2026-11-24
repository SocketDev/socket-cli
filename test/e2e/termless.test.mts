import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createTerminal } from '@termless/core'
import { createXtermBackend } from '@termless/xtermjs'
import { expect, onTestFinished, test } from 'vitest'

import { nativeFixturePathReplacements } from '../lib/native/cli-harness.mts'
import { normalizeBackendOutput } from '../lib/terminal/output.mts'
import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../lib/termless/animation.mts'

test('shows and cancels scan setup through the built socket CLI', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'socket-cli-'))
  const { version } = JSON.parse(
    await readFile(resolve('package.json'), 'utf8'),
  ) as { version: string }
  const backend = createXtermBackend()
  const normalizer = normalizeBackendOutput(backend, [
    ...nativeFixturePathReplacements(cwd, await realpath(cwd)),
    { search: version, replacement: '<SOCKET_CLI_VERSION>' },
  ])
  const terminal = createTerminal({ backend, cols: 128, rows: 30 })
  onTestFinished(async () => {
    await terminal.close()
    await rm(cwd, { recursive: true, force: true })
  })

  await terminal.spawn(
    [
      process.execPath,
      resolve('bin/cli.js'),
      'scan',
      'setup',
      '--config',
      '{}',
    ],
    {
      cwd,
      env: { CI: '1', VITEST: '', NO_COLOR: '', NO_UPDATE_NOTIFIER: '1' },
    },
  )
  await terminal.waitFor('Which scan command do you want to configure?', 30_000)
  await terminal.waitForStable(150, 10_000)
  const menu = await captureCheckpoint(terminal, 'menu')
  terminal.press('ArrowUp')
  await terminal.waitForStable(150, 10_000)
  terminal.press('Enter')
  await expect.poll(() => terminal.exitInfo, { timeout: 30_000 }).toBe('exit=0')
  normalizer.flush()
  const canceled = await captureCheckpoint(terminal, 'canceled')

  await expectTerminalAnimation(createRecording([menu, canceled]), {
    flow: 'npm-scan-setup',
    expectedSequence: ['menu', 'canceled'],
    snapshotsDir: join(process.cwd(), 'test/snapshots/termless'),
    artifactsDir:
      process.env.SOCKET_CLI_NATIVE_TEST_ARTIFACTS ??
      join(process.cwd(), 'build/native-test-artifacts'),
  })
}, 60_000)
