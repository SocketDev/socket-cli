/*
 * @file Hand-authored declarations for probe-github-status.mjs — the probe
 *   stays plain .mjs because the fleet github-status-check action runs it on
 *   the runner's system Node before any install exists, so the typed test
 *   surface is declared here.
 */

export interface ComponentEntry {
  id: string
  status: string
}

export interface ParsedComponents {
  entries: ComponentEntry[]
  error?: string | undefined
}

export interface Assessment {
  messages: string
  worstSeverity: number
  worstStatus: string
}

export interface Report {
  exitCode: number
  lines: string[]
  outputs: { status: string; summary: string }
}

export interface FetchLike {
  (
    url: string,
    init?: { signal?: AbortSignal | undefined } | undefined,
  ): Promise<{ ok: boolean; text(): Promise<string> }>
}

export declare const COMPONENTS_URL: string

export declare const PROBE_TIMEOUT_MS: number

export declare function monitoredName(id: string): string

export declare function severityRank(status: string): number

export declare function parseComponents(body: string): ParsedComponents

export declare function assessComponents(
  entries: readonly ComponentEntry[],
): Assessment

export declare function planUnreachable(): Report

export declare function planReport(
  assessment: Assessment,
  failOnIncident: boolean,
): Report

export declare function runCheck(
  options?:
    | {
        appendOutput?: ((line: string) => void) | undefined
        failOnIncident?: boolean | undefined
        fetchImpl?: FetchLike | undefined
        log?: ((message: string) => void) | undefined
        logError?: ((message: string) => void) | undefined
      }
    | undefined,
): Promise<number>
