#!/usr/bin/env node
/**
 * @file `setup:refero` — report the Refero design-research MCP connector's
 *   readiness, naming the exact next action for each state in its failure
 *   ladder. The `refero-design` skill degrades to fallback craft knowledge
 *   when live Refero is unavailable, and the ladder has THREE independently
 *   discovered layers (each masked the next in a real incident): the server
 *   config awaiting session approval, an expired OAuth token, and — invisible
 *   to `claude mcp list`, which reports Connected — an inactive paid MCP
 *   subscription (tool calls fail NO_SUBSCRIPTION; upgrade at
 *   https://refero.design/mcp/upgrade, an account-level purchase the operator
 *   makes). Design research is optional tooling, so every state exits ok:
 *   this step informs loudly, it never fails repo setup.
 */

import process from 'node:process'

import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type {
  EcosystemStepOptions,
  EcosystemStepResult,
} from './ecosystems.mts'

export type ReferoMcpState =
  | 'absent'
  | 'connected'
  | 'needs-auth'
  | 'pending-approval'

/**
 * Classify one MCP server's state from `claude mcp list` output. The list
 * prints one `name: <endpoint> - <status glyph + text>` line per server;
 * matching is on the line's leading `name:` label. Pure — the unit-test
 * target, driven with real captured output.
 */
export function classifyMcpServerState(
  listOutput: string,
  serverName: string,
): ReferoMcpState {
  const lines = listOutput.split(/\r?\n/)
  const prefix = `${serverName}:`
  const line = lines.find(l => l.trim().startsWith(prefix))
  if (!line) {
    return 'absent'
  }
  if (/pending approval/i.test(line)) {
    return 'pending-approval'
  }
  if (/needs authentication|failed to connect|error/i.test(line)) {
    return 'needs-auth'
  }
  if (/connected/i.test(line)) {
    return 'connected'
  }
  return 'needs-auth'
}

/**
 * The operator guidance for each state — What / Where / Saw / Fix, one string
 * per line. Pure so the messages are unit-testable.
 */
export function referoStateGuidance(state: ReferoMcpState): string[] {
  switch (state) {
    case 'absent':
      return [
        'Refero MCP is not configured for this checkout.',
        'Where: `claude mcp list` (no `refero:` entry).',
        'Saw: no server; wanted: refero registered so the refero-design skill can research live.',
        'Fix: add the server (`claude mcp add --transport http refero https://api.refero.design/mcp`), then approve + authenticate via `/mcp` in a session.',
      ]
    case 'pending-approval':
      return [
        'Refero MCP is configured but awaits session approval.',
        'Where: `claude mcp list` shows "Pending approval".',
        'Saw: unapproved server config; wanted: approved + authenticated.',
        'Fix: type `/mcp` in a Claude session, select refero, approve it, then Authenticate (browser OAuth).',
      ]
    case 'needs-auth':
      return [
        'Refero MCP is approved but not authenticated (or the token expired).',
        'Where: `claude mcp list` health probe.',
        'Saw: needs authentication; wanted: a live OAuth token.',
        'Fix: type `/mcp` in a Claude session, select refero, choose Authenticate; the browser OAuth lands the token immediately.',
      ]
    case 'connected':
      return [
        'Refero MCP is connected. One layer `claude mcp list` CANNOT see: the',
        'account also needs an active Refero MCP subscription — a tool call can',
        'still fail with NO_SUBSCRIPTION even while "Connected". If the',
        'refero-design skill reports that error, upgrade the plan at',
        'https://refero.design/mcp/upgrade (account-level purchase — an operator',
        'decision, never automated).',
      ]
    default:
      return []
  }
}

/**
 * Probe the Refero connector via `claude mcp list` and report its state with
 * the next action. Skips cleanly when the `claude` CLI is absent (CI runners,
 * containers). Always ok — design research never gates repo setup.
 */
export async function setupRefero(
  options?: EcosystemStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const { commandExists, logger, runCommand } = resolveEcosystemOptions(options)
  if (!(await commandExists('claude'))) {
    return skipResult(logger, 'refero', 'claude CLI not on PATH')
  }
  const probe = await runCommand('claude', ['mcp', 'list'], { silent: true })
  if (probe.exitCode !== 0) {
    logger.warn(
      'setup:refero — `claude mcp list` failed; cannot probe the Refero connector.',
    )
    return { ok: true, reason: 'mcp list failed', skipped: true }
  }
  const state = classifyMcpServerState(probe.stdout, 'refero')
  const lines = referoStateGuidance(state)
  if (state === 'connected') {
    logger.success('setup:refero — connector connected.')
  } else {
    logger.warn(`setup:refero — ${state}.`)
  }
  logger.group()
  for (const line of lines) {
    logger.substep(line)
  }
  logger.groupEnd()
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupRefero().then(
    result => {
      process.exitCode = result.ok ? 0 : 1
    },
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
      process.exitCode = 1
    },
  )
}
