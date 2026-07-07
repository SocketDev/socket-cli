/**
 * Triaging-findings engine CLI — the deterministic ingest + output assembly the
 * skill drives between its agent phases. The interview, dedup judgment,
 * verifier votes, severity derivation, and rationale prose stay agent-driven;
 * this owns the field normalization, id assignment, the sort, the summary
 * counts, and the every-finding-once invariant so a count can't be fabricated
 * and a finding can't be silently dropped.
 *
 * Subcommands:
 * ingest --from <records.json> --source <label> [--out <f>]
 * normalize raw records via the alias map, assign f001.. ids, compute
 * missing_fields, wrap unlocatables in the fixed envelope. Reads a bare
 * records[] array or { findings|results|issues|vulnerabilities: [...] }.
 *
 * Report --from <triaged.json> [--out-json <f>]
 * sort the triaged findings, compute the summary, assert every input id
 * appears exactly once, emit the TRIAGE.json envelope + the terminal
 * summary. --from carries { context, findings, input_ids }.
 */

import process from 'node:process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { ingest } from './lib/ingest.mts'
import type { RawRecord } from './lib/ingest.mts'
import { buildTriageEnvelope, terminalSummary } from './lib/report.mts'
import type { TriagedFinding } from './lib/report.mts'

const logger = getDefaultLogger()

function optValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

const CONTAINER_KEYS = ['findings', 'results', 'issues', 'vulnerabilities']

// Pull a records[] array from a bare array or a recognized container object.
function extractRecords(parsed: unknown): RawRecord[] {
  if (Array.isArray(parsed)) {
    return parsed as RawRecord[]
  }
  if (parsed && typeof parsed === 'object') {
    for (let i = 0, { length } = CONTAINER_KEYS; i < length; i += 1) {
      const key = CONTAINER_KEYS[i]!
      const v = (parsed as Record<string, unknown>)[key]
      if (Array.isArray(v)) {
        return v as RawRecord[]
      }
    }
  }
  throw new Error(
    'no records[] found. Pass a JSON array of records, or an object with a findings/results/issues/vulnerabilities array.',
  )
}

export function cmdIngest(argv: readonly string[]): number {
  const from = optValue(argv, '--from')
  if (!from) {
    logger.fail('ingest: --from <records.json> is required')
    return 1
  }
  const source = optValue(argv, '--source') ?? from
  const records = extractRecords(JSON.parse(readFileSync(from, 'utf8')))
  const findings = ingest(records, source)
  const out = `${JSON.stringify({ findings }, undefined, 2)}\n`
  const outPath = optValue(argv, '--out')
  if (outPath) {
    writeFileSync(outPath, out)
    logger.info(`ingested ${findings.length} finding(s) → ${outPath}`)
  } else {
    process.stdout.write(out)
  }
  return 0
}

export function cmdReport(argv: readonly string[]): number {
  const from = optValue(argv, '--from')
  if (!from) {
    logger.fail('report: --from <triaged.json> is required')
    return 1
  }
  const parsed = JSON.parse(readFileSync(from, 'utf8')) as {
    context?: Record<string, unknown> | undefined
    findings?: TriagedFinding[] | undefined
    input_ids?: string[] | undefined
  }
  const findings = parsed.findings ?? []
  const inputIds = parsed.input_ids ?? findings.map(f => f.id)
  const env = buildTriageEnvelope({
    context: parsed.context ?? {},
    findings,
    inputIds,
  })
  const out = `${JSON.stringify(env, undefined, 2)}\n`
  const outPath = optValue(argv, '--out-json')
  if (outPath) {
    writeFileSync(outPath, out)
  } else {
    writeFileSync('./TRIAGE.json', out)
  }
  process.stdout.write(`${terminalSummary(env)}\n`)
  return 0
}

export function main(argv: readonly string[]): number {
  const sub = argv[0]
  const rest = argv.slice(1)
  try {
    if (sub === 'ingest') {
      return cmdIngest(rest)
    }
    if (sub === 'report') {
      return cmdReport(rest)
    }
    logger.fail(
      `unknown subcommand ${sub ?? '(none)'}. Use \`ingest\` or \`report\`.`,
    )
    return 1
  } catch (e) {
    logger.fail(`triaging-findings engine failed: ${errorMessage(e)}`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
