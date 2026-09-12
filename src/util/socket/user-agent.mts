/**
 * User-Agent for the CLI's direct (non-SDK) Socket API calls, and for the
 * caller identifier forwarded to spawned Socket tools.
 *
 * Kept out of sdk.mts on purpose: that module is mocked wholesale across the
 * test suite, and a UA helper wired into the low-level HTTP path must not
 * disappear whenever a test stubs the SDK surface.
 */

import { buildUserAgent } from '@socketsecurity/lib-stable/http-request/user-agent'

import { getCliName } from '../../env/cli-name.mts'
import { getCliVersion } from '../../env/cli-version.mts'

// e.g. `socket/1.2.3 node/v22.0.0 darwin/arm64`. SDK-routed calls pass only the
// product token and let the SDK prepend its own base, so this is the
// raw-request counterpart. Cached — every component is stable for the process
// lifetime.
let cliUserAgent: string | undefined
export function getCliUserAgent(): string {
  if (cliUserAgent === undefined) {
    cliUserAgent = buildUserAgent({
      name: getCliName(),
      version: getCliVersion(),
    })
  }
  return cliUserAgent
}
