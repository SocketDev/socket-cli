/**
 * TEMP environment variable.
 * Temporary directory path (Windows systems).
 */

import { env } from 'node:process'

export const TEMP = env['TEMP']
