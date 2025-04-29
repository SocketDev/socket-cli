import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import type { CResult } from '../types'

// Serialize the final result object before printing it
// All commands that support the --json flag should call this before printing
export function serializeResultJson(data: CResult<unknown>): string {
  if (typeof data !== 'object' || !data) {
    process.exitCode = 1
    // We should not allow to expect the json value to be "null", or a boolean/number/string, even if they are valid "json".
    const msg =
      'There was a problem converting the data set to JSON. The JSON was not an object. Please try again without --json'
    debugLog('typeof data=', typeof data)
    if (typeof data !== 'object' && data) {
      debugLog('data:', data)
    }
    return JSON.stringify({
      ok: false,
      message: 'Unable to serialize JSON',
      data: msg
    })
  }

  try {
    return JSON.stringify(data, null, 2)
  } catch (e) {
    debugLog('Error:')
    debugLog(e)
    process.exitCode = 1
    // This could be caused by circular references, which is an "us" problem
    const msg =
      'There was a problem converting the data set to JSON. Please try again without --json'
    logger.error(msg)
    return JSON.stringify({
      ok: false,
      message: 'Unable to serialize JSON',
      data: msg
    })
  }
}
