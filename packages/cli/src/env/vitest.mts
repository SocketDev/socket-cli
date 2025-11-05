/**
 * VITEST environment variable snapshot.
 * Indicates whether code is running under Vitest test runner.
 */

import { getVitest } from '@socketsecurity/lib-internal/env/test'

export const VITEST = getVitest()
