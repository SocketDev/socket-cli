/** @fileoverview GITHUB_SERVER_URL environment variable. */

import { getGithubServerUrl } from '@socketsecurity/lib-internal/env/github'

export const GITHUB_SERVER_URL = getGithubServerUrl()
