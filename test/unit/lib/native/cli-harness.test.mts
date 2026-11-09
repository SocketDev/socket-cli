import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createNativeTerminalFixture,
  nativeFixturePathReplacements,
  nativeSpawnEnvironment,
  readNativeTestEnvironment,
} from '../../../lib/native/cli-harness.mts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

const makeStage = async (): Promise<string> => {
  const stage = await mkdtemp(
    path.join(process.env['RUNNER_TEMP'] ?? os.tmpdir(), 'sn-'),
  )
  temporaryDirectories.push(stage)
  return stage
}

describe('native CLI harness utilities', () => {
  it('validates native runner environment lazily', async () => {
    expect(() => readNativeTestEnvironment({})).toThrow(
      /binary, Node version, and stage/,
    )
    vi.stubEnv('SOCKET_CLI_NATIVE_TEST_BINARY', '')
    vi.stubEnv('SOCKET_CLI_NATIVE_TEST_NODE_VERSION', '')
    vi.stubEnv('SOCKET_CLI_NATIVE_TEST_STAGE', '')
    await expect(
      import('../../../lib/native/cli-harness.mts').then(({ captureFlow }) =>
        captureFlow({
          flow: 'missing-env',
          args: [],
          expectedText: '',
          exitCode: 0,
        }),
      ),
    ).rejects.toThrow(/binary, Node version, and stage/)
  })

  it('reads runner values and keeps Socket config override precedence explicit', () => {
    expect(
      readNativeTestEnvironment({
        SOCKET_CLI_NATIVE_TEST_BINARY: '/tmp/socket',
        SOCKET_CLI_NATIVE_TEST_NODE_VERSION: '26.13.0',
        SOCKET_CLI_NATIVE_TEST_STAGE: '/tmp/stage',
      }),
    ).toEqual({
      binary: '/tmp/socket',
      nodeVersion: '26.13.0',
      stage: '/tmp/stage',
    })
    expect(nativeSpawnEnvironment(['--help'])).toEqual({
      NO_COLOR: '',
      CI: '1',
      TERM: 'xterm-256color',
      SOCKET_CLI_CONFIG: '{}',
    })
    expect(nativeSpawnEnvironment(['--config', '{}'])).toEqual({
      NO_COLOR: '',
      CI: '1',
      TERM: 'xterm-256color',
    })
    expect(
      nativeSpawnEnvironment(['--help'], {
        CI: '0',
        SOCKET_CLI_CONFIG: 'explicit',
        TERM: 'xterm',
      }),
    ).toEqual({
      NO_COLOR: '',
      CI: '0',
      TERM: 'xterm',
      SOCKET_CLI_CONFIG: 'explicit',
    })
  })

  it('normalizes full socket.json paths before shorter fixture prefixes', () => {
    const posixPaths = nativeFixturePathReplacements(
      '/tmp/stage/f',
      '/private/tmp/stage/f',
    )
    expect(posixPaths).toContainEqual({
      search: '/tmp/stage/f/socket.json',
      replacement: '<NATIVE_FIXTURE>/socket.json',
    })
    expect(posixPaths).toContainEqual({
      search: '/private/tmp/stage/f',
      replacement: '<NATIVE_FIXTURE>',
    })
    const windowsPaths = nativeFixturePathReplacements(
      'C:\\stage\\f',
      'C:\\stage\\f',
    )
    expect(windowsPaths).toContainEqual({
      search: 'C:\\stage\\f\\socket.json',
      replacement: '<NATIVE_FIXTURE>/socket.json',
    })
  })

  it('creates an isolated 100-column terminal fixture with requested rows', async () => {
    const stage = await makeStage()
    const env = {
      SOCKET_CLI_NATIVE_TEST_BINARY: '/tmp/socket',
      SOCKET_CLI_NATIVE_TEST_NODE_VERSION: '26.13.0',
      SOCKET_CLI_NATIVE_TEST_STAGE: stage,
    }
    const fixture = await createNativeTerminalFixture(17, env)
    expect(fixture.cwd).toBe(path.join(stage, 'f'))
    expect(fixture.terminal.cols).toBe(100)
    expect(fixture.terminal.rows).toBe(17)
  })

  it('normalizes the socket-patch Windows executable label before terminal layout', async () => {
    const stage = await makeStage()
    const fixture = await createNativeTerminalFixture(10, {
      SOCKET_CLI_NATIVE_TEST_BINARY: '/tmp/socket',
      SOCKET_CLI_NATIVE_TEST_NODE_VERSION: '26.13.0',
      SOCKET_CLI_NATIVE_TEST_STAGE: stage,
    })
    fixture.terminal.backend.feed(Buffer.from('Usage: socket-patch.e'))
    fixture.terminal.backend.feed(
      Buffer.from('xe apply <PATH>\r\nsocket-patch-tool.exe\r\n'),
    )
    fixture.normalizer.flush()

    expect(fixture.terminal.screen.getText()).toContain(
      'Usage: socket-patch apply <PATH>',
    )
    expect(fixture.terminal.screen.getText()).toContain('socket-patch-tool.exe')
    expect(fixture.normalizer.matched('socket-patch.exe')).toBe(true)
  })

  it('supports wider captures for native help output', async () => {
    const stage = await makeStage()
    const fixture = await createNativeTerminalFixture(
      20,
      {
        SOCKET_CLI_NATIVE_TEST_BINARY: '/tmp/socket',
        SOCKET_CLI_NATIVE_TEST_NODE_VERSION: '26.13.0',
        SOCKET_CLI_NATIVE_TEST_STAGE: stage,
      },
      140,
    )
    expect(fixture.terminal.cols).toBe(140)
    expect(fixture.terminal.rows).toBe(20)
  })
})
