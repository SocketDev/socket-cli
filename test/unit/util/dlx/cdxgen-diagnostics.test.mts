/**
 * Unit tests for the cdxgen failure diagnostics.
 *
 * Purpose: cdxgen runs with stdio: 'inherit', so when it cannot start there is
 * no child output to explain the failure. These tests pin the property that
 * matters to a user staring at a CI log: the message is non-empty, names where
 * the CLI looked, and says what to do next.
 *
 * Related Files: - src/util/dlx/cdxgen-diagnostics.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  describeCdxgenSource,
  formatCdxgenFailureMessage,
  formatMissingCdxgenLocalPathMessage,
  isMissingCdxgenLocalPath,
} from '../../../../src/util/dlx/cdxgen-diagnostics.mts'
import { InputError } from '../../../../src/util/error/errors-types.mts'

describe('formatCdxgenFailureMessage', () => {
  it('is never empty, even with no underlying error', () => {
    const message = formatCdxgenFailureMessage()

    expect(message.trim()).not.toBe('')
    expect(message.length).toBeGreaterThan(40)
  })

  it('explains the case where the process reported no exit code and no signal', () => {
    const message = formatCdxgenFailureMessage()

    expect(message).toContain('without reporting an exit code or a signal')
  })

  it('quotes the underlying error when there is one', () => {
    const message = formatCdxgenFailureMessage(new Error('spawn cdxgen ENOENT'))

    expect(message).toContain('spawn cdxgen ENOENT')
  })

  it('survives a thrown non-Error value', () => {
    const message = formatCdxgenFailureMessage('just a string')

    expect(message.trim()).not.toBe('')
    expect(message).toContain('socket cdxgen could not run cdxgen.')
  })

  it('names where cdxgen was looked for and how to get more detail', () => {
    const message = formatCdxgenFailureMessage(new Error('boom'))

    expect(message).toContain('Where:')
    expect(message).toContain('Fix:')
    expect(message).toContain('SOCKET_CLI_DEBUG=1')
    expect(message).toContain('SOCKET_CLI_CDXGEN_LOCAL_PATH')
  })

  it('passes an InputError through instead of wrapping it', () => {
    const explained = formatMissingCdxgenLocalPathMessage('/tmp/acme-cdxgen')

    expect(formatCdxgenFailureMessage(new InputError(explained))).toBe(
      explained,
    )
  })

  it('never nests one Where/Saw/Fix block inside another', () => {
    const message = formatCdxgenFailureMessage(
      new InputError(formatMissingCdxgenLocalPathMessage('/tmp/acme-cdxgen')),
    )

    expect(message.match(/^\s*Where:/gm)).toHaveLength(1)
    expect(message.match(/^\s*Saw:/gm)).toHaveLength(1)
    expect(message.match(/^\s*Fix:/gm)).toHaveLength(1)
  })

  it('does not tell the user to set the variable that is already wrong', () => {
    const message = formatCdxgenFailureMessage(
      new InputError(formatMissingCdxgenLocalPathMessage('/tmp/acme-cdxgen')),
    )

    expect(message).not.toContain(
      'point SOCKET_CLI_CDXGEN_LOCAL_PATH at the binary',
    )
    expect(message).toContain('Correct the path, or unset')
  })

  it('still wraps a plain Error that explains nothing on its own', () => {
    const message = formatCdxgenFailureMessage(new Error('spawn EACCES'))

    expect(message).toContain('socket cdxgen could not run cdxgen.')
    expect(message).toContain('spawn EACCES')
  })
})

describe('describeCdxgenSource', () => {
  const originalPath = process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH']

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH']
    } else {
      process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH'] = originalPath
    }
  })

  it('names the dlx package when no override is configured', () => {
    delete process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH']

    expect(describeCdxgenSource()).toContain('@cyclonedx/cdxgen')
  })
})

describe('SOCKET_CLI_CDXGEN_LOCAL_PATH validation', () => {
  it('reports a path that is not on disk as missing', () => {
    expect(isMissingCdxgenLocalPath('/definitely/not/here/acme-cdxgen')).toBe(
      true,
    )
  })

  it('does not report an existing file as missing', () => {
    expect(isMissingCdxgenLocalPath(process.execPath)).toBe(false)
  })

  it('names the variable and the offending path in the message', () => {
    const message = formatMissingCdxgenLocalPathMessage(
      '/definitely/not/here/acme-cdxgen',
    )

    expect(message).toContain('SOCKET_CLI_CDXGEN_LOCAL_PATH')
    expect(message).toContain('/definitely/not/here/acme-cdxgen')
    expect(message).toContain('Fix:')
  })
})

describe('message shape', () => {
  let messages: string[] = []

  beforeEach(() => {
    messages = [
      formatCdxgenFailureMessage(),
      formatCdxgenFailureMessage(new Error('boom')),
      formatMissingCdxgenLocalPathMessage('/tmp/acme-cdxgen'),
    ]
  })

  it('emits no ANSI escape codes, so a CI log stays clean', () => {
    for (let i = 0, { length } = messages; i < length; i += 1) {
      // matching escapes is the point.
      // oxlint-disable-next-line no-control-regex -- control chars intended
      expect(messages[i]!).not.toMatch(/\[[0-9;]*m/)
    }
  })

  it('leads with what went wrong before any detail', () => {
    for (let i = 0, { length } = messages; i < length; i += 1) {
      const firstLine = messages[i]!.split(/\r?\n/)[0]!
      expect(firstLine).not.toMatch(/^\s/)
      expect(firstLine.length).toBeGreaterThan(20)
    }
  })
})
