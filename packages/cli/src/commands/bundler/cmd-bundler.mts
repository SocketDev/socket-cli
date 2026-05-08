/**
 * Socket bundler command — forwards bundler operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See utils/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from '../../utils/cli/define-handoff.mts'

export const cmdBundler = defineHandoffCommand({
  name: 'bundler',
  description: 'Run bundler with Socket Firewall security',
  spawnMode: 'dlx',
  examples: ['install', 'update', 'exec rake'],
  trackTelemetry: false,
  supportDryRun: false,
})
