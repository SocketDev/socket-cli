/**
 * Socket gem command — forwards gem operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See util/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from '../../util/cli/define-handoff.mts'

export const cmdGem = defineHandoffCommand({
  name: 'gem',
  description: 'Run gem with Socket Firewall security',
  examples: ['install rails', 'list', 'update'],
  trackTelemetry: false,
  supportDryRun: false,
})
