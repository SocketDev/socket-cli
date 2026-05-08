/**
 * Socket gem command — forwards gem operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See utils/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from '../../utils/cli/define-handoff.mts'

export const cmdGem = defineHandoffCommand({
  name: 'gem',
  description: 'Run gem with Socket Firewall security',
  spawnMode: 'dlx',
  examples: ['install rails', 'list', 'update'],
  trackTelemetry: false,
  supportDryRun: false,
})
