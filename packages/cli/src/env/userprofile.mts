/**
 * USERPROFILE environment variable.
 * User profile directory (Windows systems).
 */

import { env } from 'node:process'

export const USERPROFILE = env['USERPROFILE']
