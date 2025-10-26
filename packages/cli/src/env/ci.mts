/**
 * CI environment variable.
 * Set to true/1 when running in a continuous integration environment.
 */

import { env } from 'node:process'

export const CI = env['CI']
