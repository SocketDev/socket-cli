/**
 * Socket pnpm command — forwards pnpm operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See util/cli/define-handoff.mts.
 */

import { PNPM } from '@socketsecurity/lib/constants/agents'

import { defineHandoffCommand } from '../../util/cli/define-handoff.mts'

export const CMD_NAME = PNPM

export const cmdPnpm = defineHandoffCommand({
  name: PNPM,
  description: 'Run pnpm with Socket Firewall security',
  spawnMode: 'dlx',
  hidden: true,
  examples: ['', 'install', 'add package-name', 'dlx package-name'],
  showApiRequirements: true,
  wrapperHint: true,
})
