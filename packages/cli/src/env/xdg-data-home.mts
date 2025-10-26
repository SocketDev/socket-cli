/**
 * XDG_DATA_HOME environment variable.
 * User-specific data directory following XDG Base Directory specification (Unix systems).
 */

import { env } from 'node:process'

export const XDG_DATA_HOME = env['XDG_DATA_HOME']
