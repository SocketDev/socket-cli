/**
 * Socket nuget command — forwards nuget operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See utils/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from '../../utils/cli/define-handoff.mts'

export const cmdNuget = defineHandoffCommand({
  name: 'nuget',
  description: 'Run nuget with Socket Firewall security',
  spawnMode: 'dlx',
  examples: ['install Newtonsoft.Json', 'restore', 'list'],
  trackTelemetry: false,
  supportDryRun: false,
})
