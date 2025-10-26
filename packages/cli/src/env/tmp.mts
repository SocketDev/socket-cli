/**
 * TMP environment variable.
 * Alternative temporary directory path (Windows/Unix systems).
 */

import { env } from 'node:process'

export const TMP = env['TMP']
