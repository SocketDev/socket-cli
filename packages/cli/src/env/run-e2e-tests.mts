/**
 * RUN_E2E_TESTS environment variable.
 * Set to enable end-to-end tests that require Socket API access.
 */

import { env } from 'node:process'

export const RUN_E2E_TESTS = env['RUN_E2E_TESTS']
