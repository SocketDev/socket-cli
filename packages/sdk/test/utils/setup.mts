/** @fileoverview Vitest setup file for test utilities. */

import nock from 'nock'

import { getAbortSignal } from '@socketsecurity/lib/constants/process'
import { setMaxEventTargetListeners } from '@socketsecurity/lib/suppress-warnings'

const abortSignal = getAbortSignal()

// Disable debug output during tests
process.env['DEBUG'] = ''
delete process.env['NODE_DEBUG']

// Explicitly disable nock verbose logging to prevent circular structure errors
if (typeof nock.recorder !== 'undefined') {
  try {
    // @ts-expect-error - nock.recorder might not be typed
    nock.recorder.rec = false
  } catch {
    // Ignore if recorder doesn't exist or can't be configured
  }
}

// Increase max listeners for abortSignal to prevent warnings during high-concurrency tests.
// The batchPackageStream method can add many concurrent abort listeners.
setMaxEventTargetListeners(abortSignal, 50)
