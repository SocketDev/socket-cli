/**
 * Socket yarn command — forwards yarn operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See util/cli/define-handoff.mts.
 */

import { YARN } from '@socketsecurity/lib/constants/agents'

import { defineHandoffCommand } from '../../util/cli/define-handoff.mts'

export const CMD_NAME = YARN

export const cmdYarn = defineHandoffCommand({
  name: YARN,
  description: 'Run yarn with Socket Firewall security',
  spawnMode: 'dlx',
  hidden: true,
  examples: ['', 'install', 'add package-name'],
  showApiRequirements: true,
  wrapperHint: true,
})
