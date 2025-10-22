/** @fileoverview npm_config_user_agent environment variable. */

import { env } from 'node:process'

export const npm_config_user_agent = env['npm_config_user_agent']
