/** @fileoverview GITHUB_REF_NAME environment variable. */

import { env } from 'node:process'

export const GITHUB_REF_NAME = env['GITHUB_REF_NAME']
