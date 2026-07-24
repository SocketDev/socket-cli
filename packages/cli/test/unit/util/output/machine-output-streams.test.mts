/**
 * Unit tests for the machine-output stream policy.
 *
 * Verifies that engaging machine-output mode routes the logger's stdout-bound
 * status helpers (step / substep) to stderr, that restoring returns them to
 * stdout, and that the payload channel (logger.log) is never diverted.
 *
 * Related Files: - src/util/output/machine-output-streams.mts.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyMachineOutputStreamPolicy,
  restoreMachineOutputStreams,
} from '../../../../src/util/output/machine-output-streams.mts'

const logger = getDefaultLogger()

describe('machine-output-streams', () => {
  afterEach(() => {
    restoreMachineOutputStreams()
    vi.restoreAllMocks()
  })

  it('routes substep to stderr under --json', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockReturnValue(logger)
    const logSpy = vi.spyOn(logger, 'log').mockReturnValue(logger)

    applyMachineOutputStreamPolicy({ json: true })
    logger.substep('working')

    expect(errorSpy).toHaveBeenCalledWith('  working')
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('routes step to stderr under --json', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockReturnValue(logger)

    applyMachineOutputStreamPolicy({ json: true })
    logger.step('phase one')

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]?.[0]).toContain('phase one')
  })

  it('engages under --markdown and --quiet too', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockReturnValue(logger)

    applyMachineOutputStreamPolicy({ markdown: true })
    logger.substep('md')
    applyMachineOutputStreamPolicy({ quiet: true })
    logger.substep('quiet')

    expect(errorSpy).toHaveBeenCalledWith('  md')
    expect(errorSpy).toHaveBeenCalledWith('  quiet')
  })

  it('leaves substep on stdout when no machine flag is set', () => {
    const logSpy = vi.spyOn(logger, 'log').mockReturnValue(logger)
    const errorSpy = vi.spyOn(logger, 'error').mockReturnValue(logger)

    applyMachineOutputStreamPolicy({})
    logger.substep('human')

    // The lib default routes substep through logger.log (stdout).
    expect(logSpy).toHaveBeenCalledWith('  human')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('restores substep to stdout after machine mode ends', () => {
    const logSpy = vi.spyOn(logger, 'log').mockReturnValue(logger)
    const errorSpy = vi.spyOn(logger, 'error').mockReturnValue(logger)

    applyMachineOutputStreamPolicy({ json: true })
    logger.substep('during')
    applyMachineOutputStreamPolicy({})
    logger.substep('after')

    expect(errorSpy).toHaveBeenCalledWith('  during')
    expect(errorSpy).not.toHaveBeenCalledWith('  after')
    expect(logSpy).toHaveBeenCalledWith('  after')
  })
})
