#!/usr/bin/env node
/*
 * @file Report which AI fallback backends are reachable on this dev machine —
 *   the chain Claude routes to when Anthropic is unavailable (codex for
 *   review/diagnosis; Fireworks + Synthetic open-weight models via opencode for
 *   code + bulk). Dogfoods `@socketsecurity/lib/ai/backends`
 *   (`detectAvailableBackends` = which CLIs are on PATH) and reads each backend's
 *   own auth home WITHOUT triggering a keychain/login prompt: codex's
 *   `~/.codex/auth.json`, opencode's `auth list`, and the `ANTHROPIC_API_KEY`
 *   env slot. INFORMATIONAL by design — these backends are dev-only (CI carries
 *   the Claude key only; see _shared/multi-agent-backends.md), so absence is not
 *   a failure and the default exit is 0. Pass `--require <codex|fireworks|
 *   synthetic|anthropic>` (repeatable, comma-ok) to fail loud (exit 1) with the
 *   exact `codex login` / `opencode auth login` fix when a backend you depend on
 *   is not ready. Invocation: node scripts/fleet/ai-backends-status.mts
 *   [--require codex,fireworks].
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { detectAvailableBackends } from '@socketsecurity/lib/ai/backends'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { spawn } from '@socketsecurity/lib/process/spawn/child'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * The probed machine state the summarizer turns into per-backend statuses.
 * Gathered once (async I/O) and passed in so the summarizer stays pure +
 * testable.
 */
export interface BackendProbe {
  readonly anthropicKeyed: boolean
  readonly codexAuthed: boolean
  readonly installed: ReadonlySet<string>
  readonly opencodeProviders: ReadonlySet<string>
}

/**
 * One fallback path's readiness. `key` is the `--require` token; `fix` is the
 * copy-paste remedy when `ready` is false.
 */
export interface BackendStatus {
  readonly fix: string | undefined
  readonly key: string
  readonly label: string
  readonly ready: boolean
}

/**
 * Turn the probe into the ordered readiness list for each fallback path. Pure —
 * no I/O — so a test drives it with a synthetic probe.
 */
export function summarizeAiBackends(probe: BackendProbe): BackendStatus[] {
  const hasOpencode = probe.installed.has('opencode')
  return [
    {
      key: 'anthropic',
      label: 'Anthropic (primary — Claude)',
      ready: probe.anthropicKeyed,
      fix: probe.anthropicKeyed
        ? undefined
        : 'export ANTHROPIC_API_KEY (CI). Interactive sessions use their own auth — informational only.',
    },
    {
      key: 'codex',
      label: 'Codex (review / diagnosis)',
      ready: probe.installed.has('codex') && probe.codexAuthed,
      fix: !probe.installed.has('codex')
        ? 'install the codex CLI, then: codex login'
        : probe.codexAuthed
          ? undefined
          : 'codex login',
    },
    {
      key: 'fireworks',
      label:
        'Fireworks via opencode (code fallback — kimi-k2p7-code / glm-5p2)',
      ready: hasOpencode && probe.opencodeProviders.has('fireworks'),
      fix: !hasOpencode
        ? 'install opencode (per-developer), then: opencode auth login'
        : probe.opencodeProviders.has('fireworks')
          ? undefined
          : 'opencode auth login  # then select Fireworks AI',
    },
    {
      key: 'synthetic',
      label:
        'Synthetic via opencode (cross-provider backup — Kimi-K2.7-Code / GLM-5.2)',
      ready: hasOpencode && probe.opencodeProviders.has('synthetic'),
      fix: !hasOpencode
        ? 'install opencode (per-developer), then: opencode auth login'
        : probe.opencodeProviders.has('synthetic')
          ? undefined
          : 'opencode auth login  # then select Synthetic',
    },
  ]
}

/**
 * Read which providers opencode has authed by parsing `opencode auth list`.
 * Lenient substring match against the provider display names — opencode prints
 * a formatted tree, not JSON. Returns an empty set when opencode is absent or
 * the call fails (reported as unauthed, never a crash).
 */
export async function readOpencodeProviders(): Promise<Set<string>> {
  const found = new Set<string>()
  try {
    const result = await spawn('opencode', ['auth', 'list'], {
      stdioString: true,
    })
    const out = (
      typeof result.stdout === 'string' ? result.stdout : ''
    ).toLowerCase()
    if (out.includes('fireworks')) {
      found.add('fireworks')
    }
    if (out.includes('synthetic')) {
      found.add('synthetic')
    }
  } catch {
    // opencode missing or `auth list` failed — leave empty.
  }
  return found
}

/**
 * Gather the machine state. The only I/O entry point; everything downstream is
 * pure.
 */
export async function probeAiBackends(): Promise<BackendProbe> {
  const installed = await detectAvailableBackends()
  const codexAuthed = existsSync(path.join(os.homedir(), '.codex', 'auth.json'))
  const anthropicKeyed = Boolean(process.env['ANTHROPIC_API_KEY'])
  const opencodeProviders = installed.has('opencode')
    ? await readOpencodeProviders()
    : new Set<string>()
  return { anthropicKeyed, codexAuthed, installed, opencodeProviders }
}

/**
 * Parse `--require a,b --require c` into the set of required backend keys.
 */
export function parseRequired(argv: readonly string[]): Set<string> {
  const required = new Set<string>()
  for (let i = 0, { length } = argv; i < length; i += 1) {
    if (argv[i] === '--require') {
      const value = argv[i + 1]
      if (value) {
        const tokens = value.split(',')
        for (
          let j = 0, { length: tokenCount } = tokens;
          j < tokenCount;
          j += 1
        ) {
          const trimmed = tokens[j]!.trim()
          if (trimmed) {
            required.add(trimmed)
          }
        }
      }
    }
  }
  return required
}

function printReport(statuses: readonly BackendStatus[]): void {
  const readyCount = statuses.filter(s => s.ready).length
  logger.log(`AI fallback backends (${readyCount}/${statuses.length} ready):`)
  for (let i = 0, { length } = statuses; i < length; i += 1) {
    const s = statuses[i]!
    logger.log(`${s.label}: ${s.ready ? 'ready' : 'NOT READY'}`)
    if (s.fix) {
      logger.substep(`fix: ${s.fix}`)
    }
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const required = parseRequired(argv)
  const probe = await probeAiBackends()
  const statuses = summarizeAiBackends(probe)
  printReport(statuses)
  const missing = statuses.filter(s => required.has(s.key) && !s.ready)
  if (missing.length) {
    logger.error(
      `Required backend(s) not ready: ${missing.map(s => s.key).join(', ')}. ` +
        'Run the fix(es) above, then re-run this command.',
    )
    return 1
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code
  })
}
