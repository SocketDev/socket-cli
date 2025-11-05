/** @fileoverview GITHUB_REPOSITORY environment variable. */

import { getGithubRepository } from '@socketsecurity/lib-internal/env/github'

export const GITHUB_REPOSITORY = getGithubRepository()
