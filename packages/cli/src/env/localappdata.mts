/**
 * LOCALAPPDATA environment variable.
 * Local application data directory (Windows systems).
 */

import { env } from 'node:process'

export const LOCALAPPDATA = env['LOCALAPPDATA']
