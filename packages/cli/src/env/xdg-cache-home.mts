/**
 * XDG_CACHE_HOME environment variable.
 * User-specific cache directory following XDG Base Directory specification (Unix systems).
 */

import { getXdgCacheHome } from '@socketsecurity/lib/env/xdg'

export const XDG_CACHE_HOME = getXdgCacheHome()
