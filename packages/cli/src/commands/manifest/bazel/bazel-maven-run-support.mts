/**
 * Run-support helpers for the Bazel Maven extraction pipeline: per-invocation
 * query-option assembly, `--output_user_root` lifecycle (mint, reap, remove),
 * and the machine-readable completeness summary writer.
 */
import { mkdirSync, mkdtempSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { BazelQueryOptions } from './bazel-query-runner.mts'
import type {
  ExtractBazelOptions,
  ExtractBazelStatus,
  WorkspaceOutcome,
} from './bazel-maven-types.mts'

const logger = getDefaultLogger()

const REAP_TIMEOUT_MS = 10_000

// Machine-readable completeness signal emitted alongside the synthetic
// manifests. A `complete: false` summary tells a downstream consumer that the
// uploaded SBOM is known-incomplete so it must not be treated as an
// authoritative full closure. Enforcement of this signal is a separate
// downstream follow-up; the CLI only emits it.
const COMPLETENESS_SUMMARY_FILE_NAME = 'socket-bazel-manifest-summary.json'

// Construct the BazelQueryOptions shape used for a single workspace's
// queries. Takes everything the per-workspace loop needs as explicit params
// so it can be reused across workspaces.
export function buildQueryOpts(config: {
  baseEnv: NodeJS.ProcessEnv | undefined
  bin: string
  invocationFlags: string[]
  extractOptions: ExtractBazelOptions
  outputUserRoot: string
  spawnCwd: string
  verbose: boolean
}): BazelQueryOptions {
  const {
    baseEnv,
    bin,
    extractOptions,
    invocationFlags,
    outputUserRoot,
    spawnCwd,
    verbose,
  } = { __proto__: null, ...config } as typeof config
  return {
    bin,
    cwd: spawnCwd,
    invocationFlags,
    outputUserRoot,
    ...(extractOptions.bazelRc ? { bazelRc: extractOptions.bazelRc } : {}),
    ...(extractOptions.bazelFlags
      ? { bazelFlags: extractOptions.bazelFlags }
      : {}),
    ...(extractOptions.bazelOutputBase
      ? { bazelOutputBase: extractOptions.bazelOutputBase }
      : {}),
    ...(baseEnv ? { env: baseEnv } : {}),
    verbose,
  }
}

export function makeOutputUserRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-'))
}

// Best-effort reap of a Bazel server. Spawned with a short timeout so
// a wedged server can't itself hang the cleanup; failures are swallowed
// because the caller will remove the output_user_root regardless.
export async function reapBazelServer(
  bin: string,
  outputUserRoot: string,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<void> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  try {
    await spawn(bin, [`--output_user_root=${outputUserRoot}`, 'shutdown'], {
      timeout: REAP_TIMEOUT_MS,
    })
  } catch (e) {
    // Server may already be dead, or shutdown itself timed out — the
    // tempdir removal below is sufficient cleanup.
    if (verbose) {
      logger.log(
        `[VERBOSE] reapBazelServer: shutdown failed for ${outputUserRoot} (${errorMessage(e)}); tempdir removal will still run`,
      )
    }
  }
}

export async function removeTempdir(
  dir: string,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<void> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  try {
    await safeDelete(dir)
  } catch (e) {
    // Best effort. The next CLI invocation lands a fresh tempdir.
    if (verbose) {
      logger.log(
        `[VERBOSE] removeTempdir: ${dir} not fully removed (${errorMessage(e)}); a stale dir may linger until the next OS tempdir sweep`,
      )
    }
  }
}

// Emit the machine-readable completeness summary next to the manifests. This
// is the CLI's "is this SBOM complete?" signal in the emitted output; it
// carries the run status plus the per-workspace / per-hub breakdown so a
// downstream consumer can detect a known-incomplete upload. Best-effort: a
// failure to write the summary must never sink an otherwise-usable run, so it
// is logged under verbose and swallowed.
export async function writeCompletenessSummary(config: {
  artifactCount: number
  complete: boolean
  manifestDir: string
  manifestPaths: string[]
  status: ExtractBazelStatus
  verbose: boolean
  workspaceOutcomes: WorkspaceOutcome[]
}): Promise<void> {
  const {
    artifactCount,
    complete,
    manifestDir,
    manifestPaths,
    status,
    verbose,
    workspaceOutcomes,
  } = { __proto__: null, ...config } as typeof config
  const summary = {
    artifactCount,
    complete,
    ecosystem: 'maven',
    manifestCount: manifestPaths.length,
    status,
    workspaces: workspaceOutcomes,
  }
  try {
    mkdirSync(manifestDir, { recursive: true })
    await fs.writeFile(
      path.join(manifestDir, COMPLETENESS_SUMMARY_FILE_NAME),
      JSON.stringify(summary, null, 2),
      'utf8',
    )
  } catch (e) {
    if (verbose) {
      logger.log(
        `[VERBOSE] completeness summary not written (${errorMessage(e)}); the run result still carries the signal`,
      )
    }
  }
}
