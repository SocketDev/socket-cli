/**
 * Unit tests for telemetry exit-handler registration.
 *
 * Purpose: registering any SIGINT handler replaces Node's default
 * terminate-on-signal, so the handler has to exit or Ctrl+C does nothing.
 *
 * Related Files: - src/util/telemetry/integration.mts -
 * integration.test.mts (the tracking-side tests).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHomedir = vi.hoisted(() => vi.fn(() => '/Users/testuser'))
const signals = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }

vi.mock(import('node:os'), () => ({
  constants: { signals },
  homedir: mockHomedir,
  default: { constants: { signals }, homedir: mockHomedir },
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debugNs: vi.fn(),
}))

vi.mock(import('../../../../src/util/telemetry/service.mts'), () => ({
  TelemetryService: {
    getCurrentInstance: vi.fn(() => undefined),
  },
}))

vi.mock(import('../../../../src/util/config.mts'), () => ({
  getConfigValueOrUndef: vi.fn(() => 'test-org'),
}))

describe('setupTelemetryExitHandlers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function captureHandlers() {
    const handlers = new Map<string, () => void>()
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      handlers.set(event, handler)
      return process
    }) as never)
    const { setupTelemetryExitHandlers } =
      await import('../../../../src/util/telemetry/integration.mts')
    setupTelemetryExitHandlers()
    processOnSpy.mockRestore()
    return handlers
  }

  it('registers beforeExit plus the fatal signals', async () => {
    const handlers = await captureHandlers()

    expect([...handlers.keys()].toSorted()).toEqual([
      'SIGHUP',
      'SIGINT',
      'SIGTERM',
      'beforeExit',
    ])
  })

  it('terminates with 128 + signum on SIGINT', async () => {
    const handlers = await captureHandlers()
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)

    handlers.get('SIGINT')!()

    expect(exitSpy).toHaveBeenCalledWith(130)
    exitSpy.mockRestore()
  })

  it('terminates with 128 + signum on SIGTERM', async () => {
    const handlers = await captureHandlers()
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)

    handlers.get('SIGTERM')!()

    expect(exitSpy).toHaveBeenCalledWith(143)
    exitSpy.mockRestore()
  })

  it('skips re-registration on a duplicate call', async () => {
    const { setupTelemetryExitHandlers } =
      await import('../../../../src/util/telemetry/integration.mts')
    setupTelemetryExitHandlers()
    const processOnSpy = vi.spyOn(process, 'on')

    setupTelemetryExitHandlers()

    expect(processOnSpy).not.toHaveBeenCalled()
    processOnSpy.mockRestore()
  })
})
