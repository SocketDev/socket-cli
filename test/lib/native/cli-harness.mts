import { mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'

import { createTerminal } from '@termless/core'
import { createXtermBackend } from '@termless/xtermjs'
import { expect, onTestFinished } from 'vitest'

import {
  captureCheckpoint,
  createRecording,
  expectTerminalAnimation,
} from '../terminal/animation.mts'
import { normalizeBackendOutput } from '../terminal/output.mts'

export interface NativeTestEnvironment {
  readonly binary: string
  readonly nodeVersion: string
  readonly stage: string
}

export function readNativeTestEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NativeTestEnvironment {
  const binary = env['SOCKET_CLI_NATIVE_TEST_BINARY']
  const nodeVersion = env['SOCKET_CLI_NATIVE_TEST_NODE_VERSION']
  const stage = env['SOCKET_CLI_NATIVE_TEST_STAGE']
  if (!binary || !nodeVersion || !stage) {
    throw new Error(
      'Native test harness requires binary, Node version, and stage environment values',
    )
  }
  return { binary, nodeVersion, stage }
}

export interface NativeTerminalFixture {
  readonly cwd: string
  readonly terminal: ReturnType<typeof createTerminal>
  readonly normalizer: ReturnType<typeof normalizeBackendOutput>
}

export function nativeFixturePathReplacements(cwd: string, actualCwd: string) {
  const socketJsonPaths = [cwd, actualCwd].flatMap(directory => {
    const trimmed = directory.replace(/[\\/]+$/, '')
    return [
      path.join(directory, 'socket.json'),
      `${trimmed}/socket.json`,
      `${trimmed}\\socket.json`,
    ]
  })
  return [
    ...new Set(socketJsonPaths),
    cwd,
    actualCwd,
    cwd.replaceAll('\\', '/'),
    actualCwd.replaceAll('\\', '/'),
  ].map(search => ({
    search,
    replacement: search.endsWith('socket.json')
      ? '<NATIVE_FIXTURE>/socket.json'
      : '<NATIVE_FIXTURE>',
  }))
}

export function nativeSpawnEnvironment(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NO_COLOR: '',
    CI: '1',
    TERM: 'xterm-256color',
    ...(args.includes('--config') ? {} : { SOCKET_CLI_CONFIG: '{}' }),
    ...env,
  }
}

export async function createNativeTerminalFixture(
  rows = 30,
  env: NodeJS.ProcessEnv = process.env,
  cols = 100,
): Promise<NativeTerminalFixture> {
  const { nodeVersion, stage } = readNativeTestEnvironment(env)
  const cwd = path.join(stage, 'f')
  if (process.platform === 'win32') {
    expect(
      `ℹ No socket.json found at ${cwd}, will generate a new one`.length,
    ).toBeLessThan(cols)
  }
  await rm(cwd, { recursive: true, force: true })
  await mkdir(cwd, { recursive: true })
  const backend = createXtermBackend()
  const actualCwd = await realpath(cwd)
  const normalizer = normalizeBackendOutput(backend, [
    ...nativeFixturePathReplacements(cwd, actualCwd),
    { search: `v${nodeVersion}`, replacement: 'v<NODE_VERSION>' },
    { search: nodeVersion, replacement: '<NODE_VERSION>' },
    { search: 'socket-patch.exe', replacement: 'socket-patch' },
  ])
  const terminal = createTerminal({ cols, rows, backend })
  onTestFinished(async () => {
    await terminal.close()
    await rm(cwd, { recursive: true, force: true })
  })
  return { cwd, normalizer, terminal }
}

export async function captureFlow(options: {
  flow: string
  args: string[]
  expectedText: string
  exitCode: number
  rows?: number
  cols?: number
  checkpointName?: string
  env?: NodeJS.ProcessEnv
  prepare?: (fixture: NativeTerminalFixture) => Promise<void>
}): Promise<void> {
  const { binary } = readNativeTestEnvironment()
  const {
    args,
    cols = 100,
    env = {},
    exitCode,
    expectedText,
    flow,
    rows = 12,
  } = options
  const fixture = await createNativeTerminalFixture(rows, process.env, cols)
  await options.prepare?.(fixture)
  await fixture.terminal.spawn([binary, ...args], {
    cwd: fixture.cwd,
    env: nativeSpawnEnvironment(args, env),
  })
  await fixture.terminal.waitFor(expectedText, 30_000)
  await fixture.terminal.waitForStable(200, 30_000)
  await expect
    .poll(() => fixture.terminal.exitInfo, { timeout: 30_000 })
    .toBe(`exit=${exitCode}`)
  fixture.normalizer.flush()
  expect(fixture.terminal.scrollback.getText().trim()).toBe('')
  expect(fixture.terminal.screen.getText()).toContain(expectedText)
  const checkpoint = await captureCheckpoint(
    fixture.terminal,
    options.checkpointName ?? 'help',
  )
  await expectTerminalAnimation(createRecording([checkpoint]), {
    flow,
    snapshotsDir: path.join(process.cwd(), 'test/native-snapshots'),
    artifactsDir:
      process.env['SOCKET_CLI_NATIVE_TEST_ARTIFACTS'] ??
      path.join(process.cwd(), 'build/native-test-artifacts'),
    expectedSequence: [options.checkpointName ?? 'help'],
  })
}
