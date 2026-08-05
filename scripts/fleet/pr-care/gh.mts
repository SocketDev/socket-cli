/*
 * @file Gh invocation seams for the PR-care pipeline. Two laws live here:
 *
 *   1. GraphQL goes through a temp INPUT FILE and node-id lookups, never an inline
 *      query naming `owner/name`. An inline private repo name in the command
 *      string trips outbound-text scanners, and the node-id form (`node(id:
 *      $id)`) needs no repo name at all: resolve the PR's node id over REST
 *      first, then query/mutate by id.
 *   2. Every spawn is injectable so the pure planning layers test without a
 *      network or a gh install.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export interface GhRunner {
  (args: readonly string[]): Promise<{ exitCode: number; stdout: string }>
}

/**
 * The default runner: `gh <args>`, capturing stdout. Non-zero exits resolve
 * (not throw) so callers branch on exitCode — a missing check run or an
 * already-resolved thread is a state to report, not a crash.
 */
export async function runGh(
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string }> {
  try {
    const result = await spawn('gh', [...args], {
      stdio: 'pipe',
      stdioString: true,
    })
    return { exitCode: result.code ?? 0, stdout: result.stdout ?? '' }
  } catch (e) {
    const spawnError = e as {
      code?: number | undefined
      stdout?: unknown | undefined
    }
    return {
      exitCode: typeof spawnError.code === 'number' ? spawnError.code : 1,
      stdout: String(spawnError.stdout ?? ''),
    }
  }
}

/**
 * REST read returning parsed JSON, or undefined on any failure. `jq` narrows
 * the payload server-side so large PR objects stay off the wire.
 */
export async function ghRestJson(
  endpoint: string,
  jq: string,
  gh: GhRunner = runGh,
): Promise<unknown> {
  const { exitCode, stdout } = await gh(['api', endpoint, '--jq', jq])
  if (exitCode !== 0 || !stdout.trim()) {
    return undefined
  }
  try {
    return JSON.parse(stdout)
  } catch {
    return stdout.trim()
  }
}

/**
 * The GraphQL payload for a node-id query — exported so specs can pin the
 * shape without spawning anything.
 */
export function graphqlInputPayload(
  query: string,
  variables: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify({ query, variables })
}

/**
 * GraphQL via `--input <tempfile>`: the query and variables never appear in
 * the command string. Returns parsed JSON or undefined on failure.
 */
export async function ghGraphql(
  query: string,
  variables: Readonly<Record<string, unknown>>,
  gh: GhRunner = runGh,
): Promise<unknown> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pr-care-gql-'))
  const file = path.join(dir, 'query.json')
  writeFileSync(file, graphqlInputPayload(query, variables), 'utf8')
  const { exitCode, stdout } = await gh(['api', 'graphql', '--input', file])
  if (exitCode !== 0 || !stdout.trim()) {
    return undefined
  }
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}
