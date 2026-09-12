/**
 * VITEST environment variable snapshot. Indicates whether code is running under
 * Vitest test runner.
 */

import { getVitest } from '@socketsecurity/lib-stable/env/test'

export const VITEST = getVitest()
