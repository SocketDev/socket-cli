/**
 * RUN_INTEGRATION_TESTS environment variable.
 * Set to enable integration tests that require Socket API access.
 */

import { env } from 'node:process'

export const RUN_INTEGRATION_TESTS = env['RUN_INTEGRATION_TESTS']
