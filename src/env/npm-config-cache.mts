/**
 * npm_config_cache environment variable snapshot.
 * Points to the npm cache directory.
 */

import { env } from 'node:process'

export const npm_config_cache = env['npm_config_cache']
