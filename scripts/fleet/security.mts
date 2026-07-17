/*
 * @file Canonical fleet scanning-security runner. Runs three static-analysis
 *   tools the fleet uses for local security checks before push:
 *
 *   1. AgentShield — scans `.claude/` config for prompt-injection, leaked
 *      secrets, and overly-permissive tool permissions.
 *   2. zizmor — static analysis for `.github/` (unpinned actions, secret
 *      exposure, template injection, permission issues).
 *   3. skillscanner — scans `.claude/skills/` for prompt-injection and
 *      overly-permissive skill definitions.
 *
 *   Any tool missing prints a "run pnpm run setup-security-tools" hint and
 *   skips rather than failing the entire run. The `AI-fix [N/M] <file>
 *   (K findings, …)` lines visible during `pnpm run security` are from the
 *   ai-lint-fix pass (socket/* oxlint rules), not from these scanners.
 *
 *   Default mode: streams each tool's output live (stdio inherit) and exits
 *   non-zero when any tool finds issues.
 *   --json mode: captures each tool's native JSON output where available,
 *   parses to a unified Finding envelope, and writes structured JSON to
 *   stdout. The envelope shape: { findings: Finding[]; byTool:
 *   Record<tool,{code,count}>; skipped: string[] }.
 *
 *   Cross-platform: uses `which` from `@socketsecurity/lib-stable/bin` for
 *   binary discovery and `spawn` from `@socketsecurity/lib-stable/spawn` for
 *   async lifecycle. Wired via `package.json`: "security": "node
 *   scripts/fleet/security.mts". Byte-identical across every fleet repo.
 *   Sync-scaffolding flags drift.
 */

import process from 'node:process'

import { which } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

// ─── Unified finding shape ────────────────────────────────────────────────────

export interface Finding {
  file?: string | undefined
  line?: number | undefined
  message: string
  rule?: string | undefined
  severity?: string | undefined
  tool: string
}

export interface SecurityEnvelope {
  byTool: Record<string, { code: number; count: number }>
  findings: Finding[]
  skipped: string[]
}

// ─── Pure parsers (exported for unit tests) ───────────────────────────────────

// zizmor --format json emits a JSON array where each element has:
//   ident         — rule identifier (string)
//   desc          — human description (string)
//   determinations.severity — "Low"|"Medium"|"High"|"Informational" (string)
//   locations[]   — each has symbolic.key.Local.given_path (file) and
//                   concrete.location.start_point.row (0-indexed line)
//   ignored       — boolean; skip when true
// A single zizmor finding may have multiple locations; we emit one Finding per
// primary location (kind === "Primary") or fall back to the first location when
// no primary is present.
export function parseZizmorJson(json: string): Finding[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) {
    return []
  }
  const findings: Finding[] = []
  for (const item of raw) {
    if (
      typeof item !== 'object' ||
      item === null ||
      (item as Record<string, unknown>)['ignored'] === true
    ) {
      continue
    }
    const entry = item as Record<string, unknown>
    const ident =
      typeof entry['ident'] === 'string' ? entry['ident'] : undefined
    const desc =
      typeof entry['desc'] === 'string' ? entry['desc'] : String(ident ?? '')
    const det = entry['determinations']
    const severity =
      typeof det === 'object' &&
      det !== null &&
      typeof (det as Record<string, unknown>)['severity'] === 'string'
        ? ((det as Record<string, unknown>)['severity'] as string)
        : undefined
    const locations = Array.isArray(entry['locations'])
      ? (entry['locations'] as unknown[])
      : []
    const primary = locations.find(
      (l): l is Record<string, unknown> =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as Record<string, unknown>)['symbolic'] === 'object' &&
        ((l as Record<string, unknown>)['symbolic'] as Record<string, unknown>)[
          'kind'
        ] === 'Primary',
    )
    const loc = (primary ?? locations[0]) as Record<string, unknown> | undefined
    let file: string | undefined
    let line: number | undefined
    if (loc) {
      const sym = loc['symbolic'] as Record<string, unknown> | undefined
      const key = sym?.['key'] as Record<string, unknown> | undefined
      const local = key?.['Local'] as Record<string, unknown> | undefined
      if (typeof local?.['given_path'] === 'string') {
        file = local['given_path']
      }
      const concrete = loc['concrete'] as Record<string, unknown> | undefined
      const location = concrete?.['location'] as
        | Record<string, unknown>
        | undefined
      const start = location?.['start_point'] as
        | Record<string, unknown>
        | undefined
      if (typeof start?.['row'] === 'number') {
        line = (start['row'] as number) + 1
      }
    }
    findings.push({
      file,
      line,
      message: desc,
      rule: ident,
      severity,
      tool: 'zizmor',
    })
  }
  return findings
}

// agentshield scan text output heuristic (no stable --format json as of the
// fleet-pinned version; seam left for a native JSON flag if added upstream):
//   Detected: <SEVERITY> — <rule>: <message>  [file:line]
//   or: [<severity>] <file>:<line>: <message>
// Falls back to a raw-line finding when neither pattern matches, so no output
// is ever silently discarded.
//
// SEAM: if agentshield adds `--format json`, replace the text heuristic with a
// JSON parse here and update the invocation in runAgentshield() accordingly.
export function parseAgentshieldOutput(text: string): Finding[] {
  const findings: Finding[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    // Pattern A: "Detected: HIGH — rule-id: message  file.yml:12"
    const patA =
      /^Detected:\s+(\S+)\s+[—-]\s+(\S+):\s+(.+?)(?:\s{2,}(\S+):(\d+))?$/i
    const mA = line.match(patA)
    if (mA) {
      findings.push({
        file: mA[4],
        line: mA[5] ? Number(mA[5]) : undefined,
        message: (mA[3] ?? '').trim(),
        rule: mA[2],
        severity: mA[1],
        tool: 'agentshield',
      })
      continue
    }
    // Pattern B: "[severity] file:line: message"
    const patB = /^\[(\w+)\]\s+([^:]+):(\d+):\s+(.+)$/
    const mB = line.match(patB)
    if (mB) {
      findings.push({
        file: mB[2],
        line: Number(mB[3]),
        message: (mB[4] ?? '').trim(),
        severity: mB[1],
        tool: 'agentshield',
      })
      continue
    }
    // Fallback: surface the raw line so nothing is silently dropped.
    findings.push({ message: line, tool: 'agentshield' })
  }
  return findings
}

// skillscanner text output heuristic (scans .claude/skills/; same text-sniff
// pattern as agentshield; JSON seam left for a future --format json flag):
//   [<severity>] <file>:<line>: <message>
//   or: FINDING <rule> in <file>: <message>
//
// SEAM: if skillscanner adds `--format json`, replace text heuristic here and
// update the invocation in runSkillscanner() accordingly.
export function parseSkillscannerOutput(text: string): Finding[] {
  const findings: Finding[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    // Pattern A: "[severity] file:line: message"
    const patA = /^\[(\w+)\]\s+([^:]+):(\d+):\s+(.+)$/
    const mA = line.match(patA)
    if (mA) {
      findings.push({
        file: mA[2],
        line: Number(mA[3]),
        message: (mA[4] ?? '').trim(),
        severity: mA[1],
        tool: 'skillscanner',
      })
      continue
    }
    // Pattern B: "FINDING <rule> in <file>: <message>"
    const patB = /^FINDING\s+(\S+)\s+in\s+([^:]+):\s+(.+)$/i
    const mB = line.match(patB)
    if (mB) {
      findings.push({
        file: mB[2],
        message: (mB[3] ?? '').trim(),
        rule: mB[1],
        tool: 'skillscanner',
      })
      continue
    }
    // Fallback: surface raw line.
    findings.push({ message: line, tool: 'skillscanner' })
  }
  return findings
}

// ─── Tool invocation helpers ──────────────────────────────────────────────────

export interface ToolRun {
  code: number
  stdout: string
}

async function hasExecutable(name: string): Promise<boolean> {
  return Boolean(await which(name))
}

// Run a tool, returning exit code + captured stdout+stderr (capture mode) or
// inheriting stdio (default mode, preserving byte-identical non-JSON behavior).
async function runTool(
  command: string,
  args: string[],
  options: { capture: boolean },
): Promise<ToolRun> {
  const { capture } = { __proto__: null, ...options } as typeof options
  try {
    const result = await spawn(command, args, {
      shell: WIN32,
      ...(capture ? { stdioString: true } : { stdio: 'inherit' }),
    })
    return {
      code: result.code ?? 1,
      stdout: capture ? `${result.stdout ?? ''}${result.stderr ?? ''}` : '',
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: unknown }).code
      const out = e as {
        stdout?: unknown | undefined
        stderr?: unknown | undefined
      }
      return {
        code: typeof code === 'number' ? code : 1,
        stdout: capture
          ? `${typeof out.stdout === 'string' ? out.stdout : ''}${typeof out.stderr === 'string' ? out.stderr : ''}`
          : '',
      }
    }
    throw e
  }
}

// ─── Per-tool runners ─────────────────────────────────────────────────────────

async function runAgentshield(options: { capture: boolean }): Promise<ToolRun> {
  // agentshield scan target: .claude/ config; no stable JSON flag in the
  // fleet-pinned version — text output is parsed by parseAgentshieldOutput.
  return runTool('agentshield', ['scan'], options)
}

async function runZizmor(options: { capture: boolean }): Promise<ToolRun> {
  // zizmor supports --format json (verified: v1.25.2); capture mode uses it
  // so parseZizmorJson gets the native array. Default mode omits the flag so
  // colored human output streams live.
  const opts = { __proto__: null, ...options } as typeof options
  const args = opts.capture ? ['--format', 'json', '.github/'] : ['.github/']
  return runTool('zizmor', args, options)
}

async function runSkillscanner(options: {
  capture: boolean
}): Promise<ToolRun> {
  // skillscanner scan target: .claude/skills/ (its documented default scan
  // surface for skill prompt-injection analysis). No stable JSON flag in the
  // fleet-pinned version — text output is parsed by parseSkillscannerOutput.
  return runTool('skillscanner', ['.claude/skills/'], options)
}

// ─── Human-readable summary ───────────────────────────────────────────────────

function printSummary(findings: Finding[]): void {
  if (findings.length === 0) {
    return
  }
  const byTool = new Map<string, Finding[]>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const bucket = byTool.get(f.tool) ?? []
    bucket.push(f)
    byTool.set(f.tool, bucket)
  }
  for (const [tool, fs] of byTool) {
    logger.error('')
    logger.info(`${tool} findings (${fs.length}):`)
    for (const f of fs) {
      const loc = [f.file, f.line].filter(Boolean).join(':')
      const rule = f.rule ? ` ${f.rule}` : ''
      const sev = f.severity ? ` [${f.severity}]` : ''
      logger.info(`  ${loc ? `${loc} —` : ''}${sev}${rule} ${f.message}`)
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const json = process.argv.includes('--json')
  const envelope: SecurityEnvelope = {
    byTool: {},
    findings: [],
    skipped: [],
  }

  // agentshield
  if (!(await hasExecutable('agentshield'))) {
    envelope.skipped.push('agentshield')
    if (!json) {
      logger.info(
        'agentshield not installed; run "pnpm run setup-security-tools" to install',
      )
    }
  } else {
    const run = await runAgentshield({ capture: json })
    if (json) {
      const found = parseAgentshieldOutput(run.stdout)
      envelope.findings.push(...found)
      envelope.byTool['agentshield'] = { code: run.code, count: found.length }
    } else if (run.code !== 0) {
      process.exitCode = run.code
      return
    }
  }

  // zizmor
  if (!(await hasExecutable('zizmor'))) {
    envelope.skipped.push('zizmor')
    if (!json) {
      logger.info(
        'zizmor not installed; run "pnpm run setup-security-tools" to install',
      )
    }
  } else {
    const run = await runZizmor({ capture: json })
    if (json) {
      const found = parseZizmorJson(run.stdout)
      envelope.findings.push(...found)
      envelope.byTool['zizmor'] = { code: run.code, count: found.length }
    } else if (run.code !== 0) {
      process.exitCode = run.code
    }
  }

  // skillscanner
  if (!(await hasExecutable('skillscanner'))) {
    envelope.skipped.push('skillscanner')
    if (!json) {
      logger.info(
        'skillscanner not installed; run "pnpm run setup-security-tools" to install',
      )
    }
  } else {
    const run = await runSkillscanner({ capture: json })
    if (json) {
      const found = parseSkillscannerOutput(run.stdout)
      envelope.findings.push(...found)
      envelope.byTool['skillscanner'] = { code: run.code, count: found.length }
    } else if (run.code !== 0) {
      process.exitCode = run.code
    }
  }

  if (json) {
    if (envelope.findings.length > 0) {
      printSummary(envelope.findings)
    }
    process.stdout.write(`${JSON.stringify(envelope, undefined, 2)}\n`)
    // Exit nonzero when any tool reported findings or itself exited nonzero so
    // callers can use the exit code without parsing the envelope.
    const anyNonzero = Object.values(envelope.byTool).some(
      t => t.code !== 0 || t.count > 0,
    )
    if (anyNonzero) {
      process.exitCode = 1
    }
  }
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the script.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
