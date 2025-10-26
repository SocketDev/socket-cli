/**
 * TERM environment variable.
 * Terminal type for Unix-based systems (e.g., "xterm-256color").
 */

import { env } from 'node:process'

export const TERM = env['TERM']
