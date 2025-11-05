/**
 * XDG_DATA_HOME environment variable.
 * User-specific data directory following XDG Base Directory specification (Unix systems).
 */

import { getXdgDataHome } from '@socketsecurity/lib-internal/env/xdg'

export const XDG_DATA_HOME = getXdgDataHome()
