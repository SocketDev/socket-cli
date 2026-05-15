/**
 * Socket npm command — forwards npm operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See utils/cli/define-handoff.mts.
 */

import { NPM } from '@socketsecurity/lib-stable/constants/agents'

import { defineHandoffCommand } from '../../utils/cli/define-handoff.mts'

export const CMD_NAME = NPM

export const cmdNpm = defineHandoffCommand({
  name: NPM,
  description: 'Run npm with Socket Firewall security',
  // Use `auto` so SEA builds extract the npm shim from VFS while CLI
  // installs fall back to the dlx download path.
  spawnMode: 'auto',
  examples: ['', 'install cowsay', 'install -g cowsay'],
  showApiRequirements: true,
  wrapperHint: true,
})
