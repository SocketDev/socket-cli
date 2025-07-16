import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import type { CResult } from '../types.mts'

// Serialize the final result object before printing it
// All commands that support the --json flag should call this before printing
export function serializeResultJson(data: CResult<unknown>): string {
  if (typeof data !== 'object' || !data) {
    process.exitCode = 1
    debugFn('inspect', 'typeof data=', typeof data)

    if (typeof data !== 'object' && data) {
      debugFn('inspect', 'data:\n', data)
    }

    // We should not allow the JSON value to be "null", or a boolean/number/string,
    // even if they are valid "json".
    const message =
      'There was a problem converting the data set to JSON. The JSON was not an object. Please try again without --json'

    return (
      JSON.stringify({
        ok: false,
        message: 'Unable to serialize JSON',
        data: message,
      }).trim() + '\n'
    )
  }

  try {
    return JSON.stringify(data, null, 2).trim() + '\n'
  } catch (e) {
    process.exitCode = 1

    // This could be caused by circular references, which is an "us" problem
    const message =
      'There was a problem converting the data set to JSON. Please try again without --json'
    logger.fail(message)
    debugDir('inspect', { error: e })
    return (
      JSON.stringify({
        ok: false,
        message: 'Unable to serialize JSON',
        data: message,
      }).trim() + '\n'
    )
  }
}
