/**
 * Socket go command — forwards go operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See utils/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from '../../utils/cli/define-handoff.mts'

export const cmdGo = defineHandoffCommand({
  name: 'go',
  description: 'Run go with Socket Firewall security',
  spawnMode: 'dlx',
  examples: [
    'get github.com/gin-gonic/gin',
    'install golang.org/x/tools/cmd/goimports',
    'mod download',
  ],
  helpNotes: [
    'Wrapper mode works best on Linux (macOS may have keychain issues).',
  ],
  trackTelemetry: false,
  supportDryRun: false,
})
