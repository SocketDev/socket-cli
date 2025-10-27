/**
 * CI environment variable.
 * Set to true/1 when running in a continuous integration environment.
 */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const CI = envAsBoolean(env['CI'])
