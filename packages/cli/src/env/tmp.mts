/**
 * TMP environment variable. Alternative temporary directory path (Windows/Unix
 * systems).
 */

import { getTmp } from '@socketsecurity/lib-stable/env/temp-dir'

// oxlint-disable-next-line socket/exported-name-has-domain-word -- the env/ module convention exports the literal environment variable name (TMP is the Unix temp-dir var).
export const TMP = getTmp()
