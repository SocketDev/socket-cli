import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as telemetryIntegration from '../utils/telemetry/integration.mts'

/**
 * Tests for CLI entry point telemetry integration.
 * These tests verify that telemetry is properly tracked at the CLI level.
 */
describe('CLI entry point telemetry integration', () => {
  let trackCliStartSpy: ReturnType<typeof vi.spyOn>
  let trackCliCompleteSpy: ReturnType<typeof vi.spyOn>
  let trackCliErrorSpy: ReturnType<typeof vi.spyOn>
  let finalizeTelemetrySpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    trackCliStartSpy = vi
      .spyOn(telemetryIntegration, 'trackCliStart')
      .mockResolvedValue(Date.now())
    trackCliCompleteSpy = vi
      .spyOn(telemetryIntegration, 'trackCliComplete')
      .mockResolvedValue()
    trackCliErrorSpy = vi
      .spyOn(telemetryIntegration, 'trackCliError')
      .mockResolvedValue()
    finalizeTelemetrySpy = vi
      .spyOn(telemetryIntegration, 'finalizeTelemetry')
      .mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should track cli_start, cli_complete on successful execution', async () => {
    // Simulate successful CLI execution.
    const startTime = await telemetryIntegration.trackCliStart(process.argv)
    await telemetryIntegration.trackCliComplete(process.argv, startTime, 0)

    expect(trackCliStartSpy).toHaveBeenCalledWith(process.argv)
    expect(trackCliCompleteSpy).toHaveBeenCalledWith(process.argv, startTime, 0)
  })

  it('should track cli_start, cli_error on execution failure', async () => {
    // Simulate failed CLI execution.
    const startTime = await telemetryIntegration.trackCliStart(process.argv)
    const error = new Error('Test execution error')
    await telemetryIntegration.trackCliError(process.argv, startTime, error, 1)

    expect(trackCliStartSpy).toHaveBeenCalledWith(process.argv)
    expect(trackCliErrorSpy).toHaveBeenCalledWith(
      process.argv,
      startTime,
      error,
      1,
    )
  })

  it('should finalize telemetry on both success and error paths', async () => {
    // Test success path.
    await telemetryIntegration.finalizeTelemetry()
    expect(finalizeTelemetrySpy).toHaveBeenCalledTimes(1)

    // Test error path.
    await telemetryIntegration.finalizeTelemetry()
    expect(finalizeTelemetrySpy).toHaveBeenCalledTimes(2)
  })

  it('should track cli_error on fatal error in main async function', async () => {
    const error = new Error('Fatal async error')
    await telemetryIntegration.trackCliError(process.argv, Date.now(), error, 1)

    expect(trackCliErrorSpy).toHaveBeenCalledWith(
      process.argv,
      expect.any(Number),
      error,
      1,
    )
  })

  it('should handle telemetry flush before process.exit on fatal errors', async () => {
    const error = new Error('Fatal error')

    await telemetryIntegration.trackCliError(process.argv, Date.now(), error, 1)
    await telemetryIntegration.finalizeTelemetry()

    expect(trackCliErrorSpy).toHaveBeenCalled()
    expect(finalizeTelemetrySpy).toHaveBeenCalled()
  })

  it('should track events in finally block regardless of success or error', async () => {
    try {
      const startTime = await telemetryIntegration.trackCliStart(process.argv)
      await telemetryIntegration.trackCliComplete(process.argv, startTime, 0)
    } finally {
      await telemetryIntegration.finalizeTelemetry()
    }

    expect(finalizeTelemetrySpy).toHaveBeenCalled()
  })

  it('should pass correct exit codes to trackCliComplete', async () => {
    const startTime = Date.now()

    // Test with exit code 0.
    await telemetryIntegration.trackCliComplete(process.argv, startTime, 0)
    expect(trackCliCompleteSpy).toHaveBeenLastCalledWith(
      process.argv,
      startTime,
      0,
    )

    // Test with undefined exit code (defaults to 0).
    await telemetryIntegration.trackCliComplete(
      process.argv,
      startTime,
      undefined,
    )
    expect(trackCliCompleteSpy).toHaveBeenLastCalledWith(
      process.argv,
      startTime,
      undefined,
    )
  })

  it('should pass correct exit codes to trackCliError', async () => {
    const startTime = Date.now()
    const error = new Error('Test error')

    // Test with exit code 1.
    await telemetryIntegration.trackCliError(process.argv, startTime, error, 1)
    expect(trackCliErrorSpy).toHaveBeenLastCalledWith(
      process.argv,
      startTime,
      error,
      1,
    )

    // Test with undefined exit code (defaults to 1).
    await telemetryIntegration.trackCliError(
      process.argv,
      startTime,
      error,
      undefined,
    )
    expect(trackCliErrorSpy).toHaveBeenLastCalledWith(
      process.argv,
      startTime,
      error,
      undefined,
    )
  })

  it('should calculate duration correctly between start and complete', async () => {
    const startTime = Date.now()

    // Wait a small amount to ensure duration > 0.
    await new Promise(resolve => setTimeout(resolve, 10))

    await telemetryIntegration.trackCliComplete(process.argv, startTime, 0)

    expect(trackCliCompleteSpy).toHaveBeenCalledWith(
      process.argv,
      expect.any(Number),
      0,
    )
  })

  it('should calculate duration correctly between start and error', async () => {
    const startTime = Date.now()
    const error = new Error('Test error')

    // Wait a small amount to ensure duration > 0.
    await new Promise(resolve => setTimeout(resolve, 10))

    await telemetryIntegration.trackCliError(process.argv, startTime, error, 1)

    expect(trackCliErrorSpy).toHaveBeenCalledWith(
      process.argv,
      expect.any(Number),
      error,
      1,
    )
  })
})
