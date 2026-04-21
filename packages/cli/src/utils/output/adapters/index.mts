/**
 * Scrubber adapter registry — one small module per tool with known
 * output quirks. Each adapter returns a ScrubberAdapter that the
 * scrubber consults before applying its default classifier.
 */

import { gemAdapter } from './gem.mts'
import { synpAdapter } from './synp.mts'
import { zpmAdapter } from './zpm.mts'

import type { ScrubberAdapter } from '../scrubber.mts'

// Null-prototype lookup table. TypeScript's Record type doesn't allow
// us to express "keys are arbitrary strings, no prototype chain"
// directly, so we construct via Object.create and freeze.
const ADAPTERS: Readonly<Record<string, ScrubberAdapter>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ScrubberAdapter>, {
    gem: gemAdapter,
    synp: synpAdapter,
    zpm: zpmAdapter,
  }),
)

export function getScrubberAdapter(
  tool: string,
): ScrubberAdapter | undefined {
  return ADAPTERS[tool]
}

export { gemAdapter, synpAdapter, zpmAdapter }
