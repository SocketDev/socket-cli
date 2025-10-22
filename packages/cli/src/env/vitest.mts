/**
 * VITEST environment variable snapshot.
 * Indicates whether code is running under Vitest test runner.
 */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const VITEST = envAsBoolean(env['VITEST'])
