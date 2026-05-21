/**
 * Socket pip command — forwards pip operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. The pip-specific binary picker (pip ↔
 * pip3 with auto-fallback when one is missing) is wired through the factory's
 * `binaryPicker` hook.
 *
 * See util/cli/define-handoff.mts.
 */

import { whichReal } from '@socketsecurity/lib-stable/bin'

import { defineHandoffCommand } from '../../util/cli/define-handoff.mts'

/**
 * Determine the pip binary name to use based on invocation and availability.
 *
 * Priority: 1. If invoked as `socket pip3`, use 'pip3'. 2. If invoked as
 * `socket pip`, use 'pip' if it exists, else fall back to 'pip3'. 3. If pip3
 * was requested but is missing, fall back to 'pip'.
 *
 * If neither binary is available, return the originally-requested name and let
 * the spawn fail naturally — the user gets a recognizable PATH error instead of
 * an opaque fallback.
 *
 * @param invokedAs - The alias name used to invoke the command (e.g., 'pip3').
 */
export async function getPipBinName(invokedAs?: string): Promise<string> {
  const requested = invokedAs === 'pip3' ? invokedAs : 'pip'
  const fallback = requested === 'pip' ? 'pip3' : 'pip'

  if (await whichReal(requested, { nothrow: true })) {
    return requested
  }
  if (await whichReal(fallback, { nothrow: true })) {
    return fallback
  }
  return requested
}

export const cmdPip = defineHandoffCommand({
  name: 'pip',
  description: 'Run pip with Socket Firewall security',
  spawnMode: 'dlx',
  examples: ['install flask', 'install -r requirements.txt', 'list'],
  binaryPicker: ctx => getPipBinName(ctx.invokedAs),
  trackTelemetry: false,
  supportDryRun: false,
})
