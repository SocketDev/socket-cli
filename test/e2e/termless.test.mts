import { join } from 'node:path'

import { createTerminal } from '@termless/core'
import { createVtermBackend } from '@termless/vterm'
import { onTestFinished, test } from 'vitest'

import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../lib/termless/animation.mts'

test('captures the node -e fixture before and after Enter', async () => {
  const terminal = createTerminal({
    backend: createVtermBackend(),
    cols: 48,
    rows: 8,
  })
  onTestFinished(() => terminal.close())
  const script = [
    "process.stdout.write('PTY fixture\\r\\n> ready')",
    "process.stdin.once('data', () => { process.stdout.write('\\x1b[2J\\x1b[HEnter received\\r\\n'); process.exit(0) })",
  ].join(';')

  await terminal.spawn([process.execPath, '-e', script])
  await terminal.waitFor('> ready', 5000)
  const prompt = await captureCheckpoint(terminal, 'prompt')

  terminal.press('Enter')
  await terminal.waitFor('Enter received', 5000)
  const complete = await captureCheckpoint(terminal, 'after-enter')

  await expectTerminalAnimation(createRecording([prompt, complete]), {
    flow: 'node-e-fixture',
    expectedSequence: ['prompt', 'after-enter'],
    snapshotsDir: join(process.cwd(), 'test/snapshots/termless'),
    durations: [400, 400],
    artifactsDir:
      process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] ??
      join(process.cwd(), 'build/native-test-artifacts'),
  })
})
