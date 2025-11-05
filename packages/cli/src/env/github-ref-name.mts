/** @fileoverview GITHUB_REF_NAME environment variable. */

import { getGithubRefName } from '@socketsecurity/lib-internal/env/github'

export const GITHUB_REF_NAME = getGithubRefName()
