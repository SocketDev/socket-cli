/**
 * HOME environment variable. User home directory (Unix systems).
 */

import { getHome } from '@socketsecurity/lib-stable/env/home'

export const HOME = getHome()
