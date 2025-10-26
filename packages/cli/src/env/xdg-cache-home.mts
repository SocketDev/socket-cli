/**
 * XDG_CACHE_HOME environment variable.
 * User-specific cache directory following XDG Base Directory specification (Unix systems).
 */

import { env } from 'node:process'

export const XDG_CACHE_HOME = env['XDG_CACHE_HOME']
