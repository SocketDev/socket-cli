/**
 * HOME environment variable.
 * User home directory (Unix systems).
 */

import { env } from 'node:process'

export const HOME = env['HOME']
