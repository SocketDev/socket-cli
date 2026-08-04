/**
 * Diagnostics for the `socket cdxgen` command.
 *
 * Cdxgen runs as a child process, so when it cannot start there is nothing on
 * stdout or stderr to explain why. These helpers turn that into a message that
 * names where the CLI looked for cdxgen and what to try next.
 */

import { existsSync } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { resolveCdxgen } from './resolve-binary.mjs'
import { InputError } from '../error/errors-types.mts'

/**
 * Describe where the CLI resolved cdxgen from, so an error can say which of
 * the two sources actually failed.
 */
export function describeCdxgenSource(): string {
  const resolution = resolveCdxgen()
  if (resolution.type === 'local') {
    return `the local override SOCKET_CLI_CDXGEN_LOCAL_PATH=${resolution.path}`
  }
  if (resolution.type === 'dlx') {
    const { name, version } = resolution.details
    return `${name}@${version}, downloaded and cached by Socket's dlx`
  }
  return "a binary downloaded and cached by Socket's dlx"
}

/**
 * Build the message shown when cdxgen fails to produce a result.
 *
 * Pass the underlying error when there is one. Pass nothing for the case where
 * the child process ended without reporting either an exit code or a signal,
 * which is the shape that used to exit 1 with no output at all.
 */
export function formatCdxgenFailureMessage(
  cause?: unknown | undefined,
): string {
  // An InputError is raised with a message already written for the exact thing
  // that went wrong, so pass it through. Wrapping it would nest one
  // Where/Saw/Fix block inside another, and the generic Fix below would tell
  // the user to set SOCKET_CLI_CDXGEN_LOCAL_PATH when a bad value for that
  // very variable is what they are being told about.
  if (cause instanceof InputError) {
    return cause.message
  }

  const detail = cause
    ? errorMessage(cause)
    : 'the cdxgen process ended without reporting an exit code or a signal'

  return [
    'socket cdxgen could not run cdxgen.',
    `  Where: ${describeCdxgenSource()}`,
    `  Saw:   ${detail || 'no error message was reported'}`,
    '  Fix:   Re-run with SOCKET_CLI_DEBUG=1 to see the full error. If cdxgen',
    '         cannot be downloaded on this machine, install it yourself and',
    '         point SOCKET_CLI_CDXGEN_LOCAL_PATH at the binary.',
  ].join('\n')
}

/**
 * Build the message shown when SOCKET_CLI_CDXGEN_LOCAL_PATH points at
 * something that is not there.
 *
 * Without this check the override is silently ignored and the failure looks
 * identical to a download failure, which makes the override appear to have no
 * effect at all.
 */
export function formatMissingCdxgenLocalPathMessage(localPath: string): string {
  return [
    'SOCKET_CLI_CDXGEN_LOCAL_PATH points at a file that does not exist.',
    `  Where: ${localPath}`,
    '  Saw:   nothing at that path',
    '  Fix:   Correct the path, or unset SOCKET_CLI_CDXGEN_LOCAL_PATH to let',
    '         Socket download cdxgen itself. On a CI runner, check that the',
    '         path exists in the same step that runs socket cdxgen.',
  ].join('\n')
}

/**
 * True when a local cdxgen override is configured but missing from disk.
 */
export function isMissingCdxgenLocalPath(localPath: string): boolean {
  return !existsSync(localPath)
}
