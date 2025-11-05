/**
 * DISABLE_GITHUB_CACHE environment variable snapshot.
 * Disables GitHub API caching in Socket CLI.
 */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const DISABLE_GITHUB_CACHE = envAsBoolean(env['DISABLE_GITHUB_CACHE'])
