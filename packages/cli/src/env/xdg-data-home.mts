/**
 * XDG_DATA_HOME environment variable.
 * User-specific data directory following XDG Base Directory specification (Unix systems).
 */

import { getXdgDataHome } from '@socketsecurity/lib-stable/env/xdg'

export const XDG_DATA_HOME = getXdgDataHome()
