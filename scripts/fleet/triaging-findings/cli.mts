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
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { ingest } from './lib/ingest.mts'
import type { RawRecord } from './lib/ingest.mts'
import { buildTriageEnvelope, terminalSummary } from './lib/report.mts'
import type { TriagedFinding, TriageEnvelope } from './lib/report.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { resolveRepoRoot } from '../_shared/git-mutex.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import {
  localAssistEnabled,
  resolveOdaiBin,
  runOdai,
} from '../_shared/odai.mts'

const logger = getDefaultLogger()

// The keyless triage explanation is a value-add, never a gate: bounded so a
// cold on-device model can't stall the report, and any skip/failure just drops
// it — the deterministic terminal summary always stands on its own.
const ODAI_TRIAGE_TIMEOUT_MS = 45_000

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
    writeThroughMirrorLock(outPath, out)
    logger.info(`ingested ${findings.length} finding(s) → ${outPath}`)
  } else {
    process.stdout.write(out)
  }
  return 0
}

// A compact, model-facing digest of the confirmed findings — the terminal
// summary plus one line per true positive. Titles and severities only; the
// on-device triage task turns this into a plain-language paragraph. Pure.
export function findingsDigest(env: TriageEnvelope): string {
  const lines = [terminalSummary(env), '', 'Confirmed findings:']
  let confirmed = 0
  for (const f of env.findings) {
    if (f.verdict === 'true_positive') {
      lines.push(`- [${f.severity}] ${String(f['title'] ?? f.id)}`)
      confirmed += 1
    }
  }
  return confirmed ? lines.join('\n') : ''
}

/**
 * Keyless plain-language triage: when the repo opted into `ai.localAssist` and
 * an odai binary resolves, explain the confirmed findings through the on-device
 * `triage` task. Returns '' on every opt-out / unavailable / skip / failure
 * path — the deterministic terminal summary is the source of truth and this is
 * a value-add that never gates the report. Never throws.
 */
export async function odaiTriageExplanation(
  cwd: string,
  env: TriageEnvelope,
): Promise<string> {
  if (!localAssistEnabled(cwd)) {
    return ''
  }
  const bin = resolveOdaiBin()
  if (!bin) {
    return ''
  }
  const digest = findingsDigest(env)
  if (!digest) {
    return ''
  }
  const run = await runOdai('triage', digest, {
    bin,
    cwd,
    timeoutMs: ODAI_TRIAGE_TIMEOUT_MS,
  })
  if (run.outcome !== 'ok') {
    return ''
  }
  const value = run.value as { sentences?: unknown | undefined }
  if (!Array.isArray(value?.sentences)) {
    return ''
  }
  return value.sentences
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function cmdReport(argv: readonly string[]): Promise<number> {
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
    writeThroughMirrorLock(outPath, out)
  } else {
    writeThroughMirrorLock('./TRIAGE.json', out)
  }
  process.stdout.write(`${terminalSummary(env)}\n`)
  // Anchor on the script's own location, not the caller's cwd: for a cascaded
  // fleet script that resolves to the target repo whose localAssist config
  // gates the on-device call.
  const repoRoot = resolveRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
  const explanation = await odaiTriageExplanation(repoRoot, env)
  if (explanation) {
    process.stdout.write(
      `\nPlain-language triage (on-device):\n${explanation}\n`,
    )
  }
  return 0
}

export async function main(argv: readonly string[]): Promise<number> {
  const sub = argv[0]
  const rest = argv.slice(1)
  try {
    if (sub === 'ingest') {
      return cmdIngest(rest)
    }
    if (sub === 'report') {
      return await cmdReport(rest)
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

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code
    },
    () => {
      process.exitCode = 1
    },
  )
}
