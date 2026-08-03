/**
 * Scanning-vulns engine CLI — the deterministic collate/score/render half of
 * the skill, callable from SKILL.md after each Workflow returns. The review +
 * confidence-scoring agents stay prose; this owns the math + the two output
 * files so counts and line-handling can't be fabricated or drift by hand.
 *
 * Subcommands:
 * collate  --from <raw-findings.json> --target <dir> [--out-json <f>]
 * drop-empty + light-dedupe + assign F-NNN ids in (severity, file, line)
 * order. Writes the interim findings[] JSON so the scoring agents read a
 * stable id set, and prints the deduped count.
 *
 * Finalize --from <scored-findings.json> --target <dir>
 * apply per-id scores, re-sort + re-id by (confidence, severity, file,
 * line), build VULN-FINDINGS.json with the computed summary, render
 * VULN-FINDINGS.md, write BOTH under <target-dir>, print the hand-back
 * summary. --no-score-applied skips the score merge (the --no-score path)
 * and just envelopes + renders.
 *
 * Input is always read from a --from <file> (never stdin/heredoc). Output files
 * are confined under <target-dir>.
 *
 * Usage examples: node scripts/fleet/scanning-vulns/cli.mts collate --from
 * /tmp/raw.json --target ./pkg node scripts/fleet/scanning-vulns/cli.mts
 * finalize --from /tmp/scored.json --target ./pkg.
 */

import path from 'node:path'
import process from 'node:process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  applyScores,
  assignIds,
  buildEnvelope,
  dropEmpty,
  lightDedupe,
  renderMarkdown,
  summarizeHandback,
} from './lib/collate.mts'
import type { Finding, Score } from './lib/collate.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

function optValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

// An output file must stay inside the target tree (the skill's "stay in
// <target-dir>" constraint) — reject a name that resolves outside it.
function confineUnderTarget(targetDir: string, name: string): string {
  const target = path.resolve(targetDir)
  const out = path.resolve(target, name)
  const rel = path.relative(target, out)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `output path escapes the target tree: ${name} resolves outside ${targetDir}. Pass a name inside the target.`,
    )
  }
  return out
}

function atomicWrite(target: string, data: string): void {
  mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, target)
}

function readFindings(fromPath: string | undefined): Finding[] {
  if (!fromPath) {
    throw new Error(
      'no --from <file> given. The findings JSON must be read from a file (never stdin); write the collected agent results to a scratch file and pass --from <that-file>.',
    )
  }
  const parsed: unknown = JSON.parse(readFileSync(fromPath, 'utf8'))
  // Accept either a bare findings[] or a { findings: [...] } envelope.
  if (Array.isArray(parsed)) {
    return parsed as Finding[]
  }
  if (parsed && typeof parsed === 'object' && 'findings' in parsed) {
    const f = (parsed as { findings?: unknown | undefined }).findings
    if (Array.isArray(f)) {
      return f as Finding[]
    }
  }
  throw new Error(
    `${fromPath} is neither a findings[] array nor a { findings: [...] } envelope. Write the collected FINDINGS_SCHEMA results as a JSON array.`,
  )
}

export function cmdCollate(argv: readonly string[]): number {
  const target = optValue(argv, '--target')
  if (!target) {
    logger.fail('collate: --target <dir> is required')
    return 1
  }
  const raw = readFindings(optValue(argv, '--from'))
  const deduped = lightDedupe(dropEmpty(raw))
  const withIds = assignIds(deduped.findings)
  const outPath =
    optValue(argv, '--out-json') ??
    confineUnderTarget(target, '.vuln-collated.json')
  atomicWrite(
    outPath,
    `${JSON.stringify({ findings: withIds }, undefined, 2)}\n`,
  )
  logger.info(
    `collated ${withIds.length} finding(s) (${deduped.duplicates} duplicate(s) merged) → ${outPath}`,
  )
  return 0
}

export function cmdFinalize(argv: readonly string[]): number {
  const target = optValue(argv, '--target')
  if (!target) {
    logger.fail('finalize: --target <dir> is required')
    return 1
  }
  const fromPath = optValue(argv, '--from')
  const parsed: unknown = JSON.parse(readFileSync(fromPath!, 'utf8'))
  const findings = readFindings(fromPath)
  const scores =
    parsed && typeof parsed === 'object' && 'scores' in parsed
      ? ((parsed as { scores?: unknown | undefined }).scores as
          | Score[]
          | undefined)
      : undefined
  const focusAreas =
    parsed && typeof parsed === 'object' && 'focus_areas' in parsed
      ? (((parsed as { focus_areas?: unknown | undefined })
          .focus_areas as string[]) ?? [])
      : []
  const sourceFileCount =
    parsed && typeof parsed === 'object' && 'source_file_count' in parsed
      ? Number(
          (parsed as { source_file_count?: unknown | undefined })
            .source_file_count,
        ) || 0
      : 0
  const scannedAt = optValue(argv, '--scanned-at') ?? '(unknown)'

  const scored =
    argv.includes('--no-score-applied') || !scores
      ? assignIds(findings)
      : applyScores(findings, scores)
  const env = buildEnvelope({
    findings: scored,
    focusAreas,
    scannedAt,
    target,
  })
  atomicWrite(
    confineUnderTarget(target, 'VULN-FINDINGS.json'),
    `${JSON.stringify(env, undefined, 2)}\n`,
  )
  atomicWrite(
    confineUnderTarget(target, 'VULN-FINDINGS.md'),
    renderMarkdown(env),
  )
  process.stdout.write(`${summarizeHandback(env, sourceFileCount)}\n`)
  return 0
}

export function main(argv: readonly string[]): number {
  const sub = argv[0]
  const rest = argv.slice(1)
  try {
    if (sub === 'collate') {
      return cmdCollate(rest)
    }
    if (sub === 'finalize') {
      return cmdFinalize(rest)
    }
    logger.fail(
      `unknown subcommand ${sub ?? '(none)'}. Use \`collate\` or \`finalize\`.`,
    )
    return 1
  } catch (e) {
    logger.fail(`scanning-vulns engine failed: ${errorMessage(e)}`)
    return 1
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
