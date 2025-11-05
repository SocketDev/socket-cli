/**
 * SOCKET_CLI_BOOTSTRAP_CACHE_DIR environment variable.
 * Cache directory path passed from bootstrap wrappers.
 */

import { getSocketCliBootstrapCacheDir } from '@socketsecurity/lib-internal/env/socket-cli'

export const SOCKET_CLI_BOOTSTRAP_CACHE_DIR = getSocketCliBootstrapCacheDir()
