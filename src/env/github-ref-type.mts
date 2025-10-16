/** @fileoverview GITHUB_REF_TYPE environment variable. */

import { env } from 'node:process'

export const GITHUB_REF_TYPE = env['GITHUB_REF_TYPE']
