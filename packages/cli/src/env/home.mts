/**
 * HOME environment variable.
 * User home directory (Unix systems).
 */

import { getHome } from '@socketsecurity/lib-internal/env/home'

export const HOME = getHome()
