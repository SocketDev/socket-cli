/**
 * TMP environment variable.
 * Alternative temporary directory path (Windows/Unix systems).
 */

import { getTmp } from '@socketsecurity/lib/env/temp-dir'

export const TMP = getTmp()
