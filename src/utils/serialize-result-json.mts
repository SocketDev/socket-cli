import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isObject } from '@socketsecurity/registry/lib/objects'

import type { CResult } from '../types.mts'

// Serialize the final result object before printing it
// All commands that support the --json flag should call this before printing
export function serializeResultJson(data: CResult<unknown>): string {
  if (!isObject(data)) {
    process.exitCode = 1

    debugFn('inspect', { data })

    // We should not allow the JSON value to be "null", or a boolean/number/string,
    // even if they are valid "json".
    return `${JSON.stringify({
      ok: false,
      message: 'Unable to serialize JSON',
      cause:
        'There was a problem converting the data set to JSON. The JSON was not an object. Please try again without --json',
    }).trim()}\n`
  }

  try {
    return `${JSON.stringify(data, null, 2).trim()}\n`
  } catch (e) {
    process.exitCode = 1

    const message =
      'There was a problem converting the data set to JSON. Please try again without --json'

    logger.fail(message)
    debugDir('inspect', { error: e })

    // This could be caused by circular references, which is an "us" problem.
    return `${JSON.stringify({
      ok: false,
      message: 'Unable to serialize JSON',
      cause: message,
    }).trim()}\n`
  }
}
