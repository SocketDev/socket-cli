/**
 * @file Depot CI API client — https://api.depot.dev, Connect-RPC over HTTP,
 *   service `depot.ci.v1.CIService`. Every call is `POST <BASE>/<Method>` with
 *   a JSON body and `Authorization: Bearer <DEPOT_TOKEN>`; the token's
 *   organization scopes the results, so requests carry NO org/project id. Used
 *   to pull fleet CI test-results: list runs, read job summaries + failure
 *   diagnosis, list/download artifacts, and rerun/retry. The token comes from
 *   the env (CI) or the OS keychain (dev) and is NEVER written to a file.
 *   Library: import { listRuns, getFailureDiagnosis } from './depot-ci.mts'
 *   CLI: node scripts/fleet/depot-ci.mts runs [--repo o/n] [--status failed]
 *   node scripts/fleet/depot-ci.mts diagnose <run-id>
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()
const BASE = 'https://api.depot.dev/depot.ci.v1.CIService'

export type FailureDiagnosisTargetType =
  | 'FAILURE_DIAGNOSIS_TARGET_TYPE_ATTEMPT'
  | 'FAILURE_DIAGNOSIS_TARGET_TYPE_JOB'
  | 'FAILURE_DIAGNOSIS_TARGET_TYPE_RUN'
  | 'FAILURE_DIAGNOSIS_TARGET_TYPE_WORKFLOW'

export interface DepotArtifact {
  readonly artifactId: string
  readonly attempt: number
  readonly attemptId: string
  readonly createdAt: string
  readonly jobId: string
  readonly jobKey: string
  readonly name: string
  readonly runId: string
  readonly sizeBytes: string
  readonly workflowId: string
  readonly workflowPath: string
}

export interface DepotRun {
  readonly createdAt: string
  readonly headSha: string
  readonly ref: string
  readonly repo: string
  readonly runId: string
  readonly sha: string
  readonly status: string
  readonly trigger: string
}

export interface ListRunsRequest {
  readonly pageSize?: number | undefined
  readonly pageToken?: string | undefined
  readonly pr?: string | undefined
  readonly repo?: string | undefined
  readonly sha?: string | undefined
  readonly status?: readonly string[] | undefined
  readonly trigger?: string | undefined
}

export interface ListRunsResponse {
  readonly nextPageToken: string
  readonly runs: readonly DepotRun[]
}

export interface ListArtifactsRequest {
  readonly attemptId?: string | undefined
  readonly jobId?: string | undefined
  readonly pageSize?: number | undefined
  readonly pageToken?: string | undefined
  readonly runId: string
  readonly workflowId?: string | undefined
}

export interface ListArtifactsResponse {
  readonly artifacts: readonly DepotArtifact[]
  readonly nextPageToken: string
}

export interface ArtifactDownloadResponse {
  readonly artifact: DepotArtifact
  readonly expiresAt: string
  readonly url: string
}

export interface DepotCallOptions {
  readonly token?: string | undefined
}

/**
 * Resolve the Depot bearer token from the env. Never read from / written to a
 * file — CI sets it as a secret, dev keeps it in the OS keychain.
 */
export function depotToken(options?: DepotCallOptions | undefined): string {
  const opts = { __proto__: null, ...options } as DepotCallOptions
  const token = opts.token ?? process.env['DEPOT_TOKEN']
  if (!token) {
    throw new Error(
      'DEPOT_TOKEN is not set. Export it (CI secret) or load it from the keychain; never commit it.',
    )
  }
  return token
}

/**
 * One Connect-RPC call: `POST <BASE>/<method>` with a JSON body, bearer auth.
 * Throws `HttpResponseError` (from httpJson) on a non-2xx response.
 */
export async function depotCall<T>(
  method: string,
  request: object,
  options?: DepotCallOptions | undefined,
): Promise<T> {
  return await httpJson<T>(`${BASE}/${method}`, {
    body: JSON.stringify(request),
    headers: { Authorization: `Bearer ${depotToken(options)}` },
    method: 'POST',
  })
}

export async function listRuns(
  request?: ListRunsRequest | undefined,
  options?: DepotCallOptions | undefined,
): Promise<ListRunsResponse> {
  return await depotCall<ListRunsResponse>(
    'ListRuns',
    { __proto__: null, ...request },
    options,
  )
}

export async function getRunStatus(
  runId: string,
  options?: DepotCallOptions | undefined,
): Promise<unknown> {
  return await depotCall('GetRunStatus', { __proto__: null, runId }, options)
}

export async function getJobSummary(
  jobId: string,
  options?: DepotCallOptions | undefined,
): Promise<unknown> {
  return await depotCall('GetJobSummary', { __proto__: null, jobId }, options)
}

/**
 * Grouped failure analysis for a run/workflow/job/attempt. The response shape
 * is upstream-defined and (per the docs) only partially documented, so it is
 * returned as `unknown` for the caller to narrow.
 */
export async function getFailureDiagnosis(
  targetId: string,
  targetType: FailureDiagnosisTargetType,
  options?: DepotCallOptions | undefined,
): Promise<unknown> {
  return await depotCall(
    'GetFailureDiagnosis',
    { __proto__: null, targetId, targetType },
    options,
  )
}

export async function listArtifacts(
  request: ListArtifactsRequest,
  options?: DepotCallOptions | undefined,
): Promise<ListArtifactsResponse> {
  return await depotCall<ListArtifactsResponse>(
    'ListArtifacts',
    { __proto__: null, ...request },
    options,
  )
}

export async function getArtifactDownloadUrl(
  artifactId: string,
  options?: DepotCallOptions | undefined,
): Promise<ArtifactDownloadResponse> {
  return await depotCall<ArtifactDownloadResponse>(
    'GetArtifactDownloadURL',
    { __proto__: null, artifactId },
    options,
  )
}

function parseRunsArgs(args: readonly string[]): ListRunsRequest {
  const req = { __proto__: null } as {
    -readonly [K in keyof ListRunsRequest]: ListRunsRequest[K]
  }
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]
    if (arg === '--repo') {
      req.repo = args[++i]
    } else if (arg === '--status') {
      req.status = [args[++i]!]
    } else if (arg === '--sha') {
      req.sha = args[++i]
    } else if (arg === '--pr') {
      req.pr = args[++i]
    } else if (arg === '--trigger') {
      req.trigger = args[++i]
    }
  }
  return req
}

/**
 * CLI entry: `runs [--repo o/n] [--status s] [--sha x] [--pr n] [--trigger t]`
 * lists recent runs; `diagnose <run-id>` prints the failure diagnosis.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv
  if (command === 'runs') {
    const { runs } = await listRuns(parseRunsArgs(rest))
    for (const run of runs) {
      logger.log(
        `${run.status.padEnd(9)} ${run.repo}@${run.sha.slice(0, 8)} ${run.trigger} ${run.runId}`,
      )
    }
    return
  }
  if (command === 'diagnose') {
    const runId = rest[0]
    if (!runId) {
      logger.fail('usage: depot-ci.mts diagnose <run-id>')
      process.exitCode = 1
      return
    }
    const diagnosis = await getFailureDiagnosis(
      runId,
      'FAILURE_DIAGNOSIS_TARGET_TYPE_RUN',
    )
    logger.log(JSON.stringify(diagnosis, undefined, 2))
    return
  }
  logger.fail(
    'usage: depot-ci.mts <runs|diagnose> [...]  (needs DEPOT_TOKEN in env)',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
