/**
 * Shared constants for the build-pipeline orchestrator (socket-cli variant).
 *
 * Mirrors the socket-btm/ultrathink/socket-tui/sdxgen API surface
 * (BUILD_STAGES, CHECKPOINTS, CHECKPOINT_CHAINS, validateCheckpointChain,
 * getBuildMode). socket-cli doesn't build wasm — it consumes pre-built
 * wasm + node binaries from socket-btm — so the orchestrator name
 * ('build-pipeline') is historical; the machinery is build-type-agnostic.
 */

import process from 'node:process'

import { getCI } from '@socketsecurity/lib/env/ci'

/**
 * Build stage directory names inside build/<mode>/.
 */
export const BUILD_STAGES = {
  BUNDLED: 'Bundled',
  FINAL: 'Final',
  OPTIMIZED: 'Optimized',
  RELEASE: 'Release',
  STRIPPED: 'Stripped',
  SEA: 'Sea',
  SYNC: 'Sync',
  TYPES: 'Types',
}

/**
 * Canonical checkpoint names. Each pipeline stage picks one.
 */
export const CHECKPOINTS = {
  CLI: 'cli',
  FINALIZED: 'finalized',
  SEA: 'sea',
}

const VALID_CHECKPOINT_VALUES = new Set(Object.values(CHECKPOINTS))

/**
 * Checkpoint chain for socket-cli's build pipeline.
 * Order: newest → oldest (matching socket-btm convention).
 *
 * The SEA binary is built only for --force / --prod today; the chain is
 * declared including SEA so --clean-stage=sea works when it runs.
 */
export const CHECKPOINT_CHAINS = {
  cli: () => [CHECKPOINTS.FINALIZED, CHECKPOINTS.SEA, CHECKPOINTS.CLI],
}

/**
 * Validate a checkpoint chain at runtime.
 */
export function validateCheckpointChain(
  chain: string[],
  packageName: string,
) {
  if (!Array.isArray(chain)) {
    throw new Error(`${packageName}: Checkpoint chain must be an array`)
  }
  if (chain.length === 0) {
    throw new Error(`${packageName}: Checkpoint chain cannot be empty`)
  }
  const invalid = chain.filter(cp => !VALID_CHECKPOINT_VALUES.has(cp))
  if (invalid.length) {
    throw new Error(
      `${packageName}: Invalid checkpoint names in chain: ${invalid.join(', ')}. ` +
        `Valid: ${Object.keys(CHECKPOINTS).join(', ')}`,
    )
  }
  const seen = new Set()
  for (const cp of chain) {
    if (seen.has(cp)) {
      throw new Error(`${packageName}: Duplicate checkpoint in chain: ${cp}`)
    }
    seen.add(cp)
  }
}

// Validate chain registry at module load.
for (const [name, generator] of Object.entries(CHECKPOINT_CHAINS)) {
  validateCheckpointChain(generator(), `CHECKPOINT_CHAINS.${name}`)
}

/**
 * Resolve the build mode from CLI flags, env, or CI autodetect.
 */
export function getBuildMode(args?: string[] | Set<string>): string {
  if (args) {
    const has = Array.isArray(args)
      ? (flag: string) => args.includes(flag)
      : (flag: string) => args.has(flag)
    if (has('--prod')) {
      return 'prod'
    }
    if (has('--dev')) {
      return 'dev'
    }
  }
  if (process.env['BUILD_MODE']) {
    return process.env['BUILD_MODE']
  }
  return getCI() ? 'prod' : 'dev'
}

/**
 * Path used by platform-mappings.isMusl() for Alpine detection.
 */
export const ALPINE_RELEASE_FILE = '/etc/alpine-release'
