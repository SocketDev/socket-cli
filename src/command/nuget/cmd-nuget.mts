/**
 * Socket nuget command — forwards nuget operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See util/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from '../../util/cli/define-handoff.mts'

export const cmdNuget = defineHandoffCommand({
  name: 'nuget',
  description: 'Run nuget with Socket Firewall security',
  examples: ['install Newtonsoft.Json', 'restore', 'list'],
  trackTelemetry: false,
  supportDryRun: false,
})
