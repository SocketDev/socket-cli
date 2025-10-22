/**
 * NODE_OPTIONS environment variable snapshot.
 * Used to pass options to Node.js runtime.
 */

import { env } from 'node:process'

export const NODE_OPTIONS = env['NODE_OPTIONS']
