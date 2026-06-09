/**
 * @file Oxlint `--format=json` data layer for the ai-lint-fix step: the raw
 *   diagnostic shapes, normalization into the ESLint-style OxlintFile[] the
 *   rest of the step consumes, and the runner that invokes oxlint and parses
 *   its output. Keeps the JSON/spawn concerns out of the orchestrator.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

const logger = getDefaultLogger()

export interface OxlintMessage {
  ruleId?: string | undefined
  message: string
  severity: number
  line: number
  column: number
  endLine?: number | undefined
  endColumn?: number | undefined
}

export interface OxlintFile {
  filePath: string
  messages: OxlintMessage[]
}

/**
 * Raw shape of a diagnostic in oxlint's `--format=json` output. The wrapper
 * object is `{ "diagnostics": [Diagnostic, ...] }`. Each diagnostic carries
 * `code` (e.g. `"socket(rule-id)"`), `filename`, and a `labels[]` array whose
 * first entry has the source span.
 */
export interface OxlintDiagnostic {
  code: string
  filename: string
  message: string
  severity: string
  labels: Array<{
    span: {
      offset: number
      length: number
      line: number
      column: number
    }
  }>
}

export interface OxlintJsonOutput {
  diagnostics: OxlintDiagnostic[]
}

/**
 * Normalize oxlint's `{diagnostics:[...]}` payload into the ESLint-style
 * `OxlintFile[]` shape the rest of the step expects. Strip the `socket(...)`
 * wrapper around the rule code so AI_HANDLED_RULES (which stores bare rule
 * names) matches.
 */
export function normalizeOxlintJson(payload: OxlintJsonOutput): OxlintFile[] {
  const byFile = new Map<string, OxlintMessage[]>()
  for (const d of payload.diagnostics) {
    const label = d.labels[0]
    if (!label) {
      continue
    }
    // `code` looks like "socket(prefer-async-spawn)" or
    // "eslint(no-unused-vars)"; strip the plugin wrapper.
    const ruleId =
      typeof d.code === 'string' && d.code.includes('(')
        ? d.code.replace(/^[^(]+\(([^)]+)\).*$/, '$1') // `^[^(]+` plugin name; `([^)]+)` captures rule id; `\).*$` discards the rest
        : d.code
    const msg: OxlintMessage = {
      ruleId,
      message: d.message,
      severity: d.severity === 'error' ? 2 : 1,
      line: label.span.line,
      column: label.span.column,
    }
    const existing = byFile.get(d.filename)
    if (existing) {
      existing.push(msg)
    } else {
      byFile.set(d.filename, [msg])
    }
  }
  return Array.from(byFile, ([filePath, messages]) => ({ filePath, messages }))
}

export async function runLintJson(
  passthrough: readonly string[],
): Promise<OxlintFile[]> {
  // Run oxlint directly with --format=json. Bypass `pnpm run lint`
  // because that wrapper formats for humans.
  const args = [
    'exec',
    'oxlint',
    '--format=json',
    '--config=.config/fleet/oxlintrc.json',
    ...passthrough.filter(a => a !== '--all'),
  ]
  if (!passthrough.includes('--all') && !passthrough.includes('--staged')) {
    args.push('.')
  }
  let stdout = ''
  try {
    const result = await spawn('pnpm', args, {
      shell: process.platform === 'win32',
      stdio: 'pipe',
      stdioString: true,
    })
    stdout = String(result.stdout ?? '')
  } catch (e) {
    if (isSpawnError(e)) {
      // oxlint exits non-zero when there are violations — that's
      // expected. Read stdout regardless.
      stdout = String(e.stdout ?? '')
    } else {
      throw e
    }
  }
  if (!stdout.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(stdout) as OxlintJsonOutput
    if (!parsed || !Array.isArray(parsed.diagnostics)) {
      return []
    }
    return normalizeOxlintJson(parsed)
  } catch {
    logger.warn('oxlint JSON parse failed; skipping AI-fix')
    return []
  }
}
