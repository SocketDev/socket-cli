/** @fileoverview NODE_ENV environment variable. */

import { env } from 'node:process'

export const NODE_ENV = env['NODE_ENV']
