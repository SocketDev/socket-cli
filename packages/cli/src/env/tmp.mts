/**
 * TMP environment variable.
 * Alternative temporary directory path (Windows/Unix systems).
 */

import { getTmp } from '@socketsecurity/lib-internal/env/temp-dir'

export const TMP = getTmp()
