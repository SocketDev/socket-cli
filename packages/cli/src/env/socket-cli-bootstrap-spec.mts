/**
 * SOCKET_CLI_BOOTSTRAP_SPEC environment variable.
 * Package spec passed from bootstrap wrappers (e.g., @socketsecurity/cli@^2.0.11).
 */

import { getSocketCliBootstrapSpec } from '@socketsecurity/lib-internal/env/socket-cli'

export const SOCKET_CLI_BOOTSTRAP_SPEC = getSocketCliBootstrapSpec()
