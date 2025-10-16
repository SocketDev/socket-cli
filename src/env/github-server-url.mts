/** @fileoverview GITHUB_SERVER_URL environment variable. */

import { env } from 'node:process'

export const GITHUB_SERVER_URL = env['GITHUB_SERVER_URL']
