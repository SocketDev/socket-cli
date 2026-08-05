#!/usr/bin/env node
/**
 * @file `mcp:reset` — recover the committed `.mcp.json` stdio servers when a
 *   client reports "connection timed out" on reconnect. The failure shape:
 *   a stale server process — or the browser/tool tree it spawned — from a dead
 *   session is still alive, holding its listen ports or singleton state, so
 *   the relaunch blocks until the client's connect timeout expires.
 *   Code-as-law recovery, driven entirely by the canonical `.mcp.json` (no
 *   per-server hardcoding): derive a process signature for every stdio
 *   server, find matching live processes whose working directory is THIS
 *   repo (cwd scoping — a sibling checkout's healthy janus/chrome-devtools
 *   session must survive), widen to their descendant trees (the Chromes and
 *   helpers that actually hold the ports), record the listen ports the tree
 *   holds, kill the tree (SIGTERM, grace, SIGKILL), and verify every
 *   recorded port is free again. Self-protection: the script's own ancestor
 *   chain is never a candidate, even when a wrapper shell's command line
 *   happens to contain a matching signature.
 *   Usage: `pnpm run mcp:reset` or `node scripts/fleet/mcp-reset.mts`,
 *   then reconnect in the client (`/mcp` in Claude Code). `--dry-run`
 *   reports the processes and ports that would be reclaimed without
 *   signalling anything.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- recovery tool needs simple top-level-sync ps/lsof reads; the kill path is the only async part.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import { parseCanonicalMcpConfig } from './mcp-config.mts'
import { REPO_ROOT } from './paths.mts'

import type { PortableMcpServers } from './mcp-config.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

export interface ProcessEntry {
  command: string
  pid: number
  ppid: number
}

/**
 * Interpreter/runner commands that carry no server identity of their own —
 * the signature must come from their arguments instead.
 */
const GENERIC_RUNNERS = new Set([
  'bash',
  'bun',
  'deno',
  'env',
  'node',
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'sh',
  'tsx',
  'yarn',
])

/**
 * Runner subcommands that precede the real program token (`pnpm exec foo`).
 */
const RUNNER_SUBCOMMANDS = new Set(['dlx', 'exec', 'run', 'x'])

/**
 * Derive the process-signature strings for every stdio server in the
 * canonical config: the substrings of a live command line that identify the
 * server. A non-generic command contributes its basename; a generic runner
 * contributes its first non-flag, non-subcommand argument — the program — and
 * path-shaped tokens also contribute their repo-resolved absolute form so
 * both `node scripts/fleet/x.mts` and an absolute-path launch match.
 */
export function deriveServerSignatures(
  servers: PortableMcpServers,
  repoRoot: string,
): Map<string, string[]> {
  const signatures = new Map<string, string[]>()
  const entries = Object.entries(servers)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [name, server] = entries[i]!
    if (server.kind !== 'stdio') {
      continue
    }
    const tokens = new Set<string>()
    const commandBase = path.basename(server.command)
    if (!GENERIC_RUNNERS.has(commandBase)) {
      tokens.add(commandBase)
    }
    for (let j = 0, argCount = server.args.length; j < argCount; j += 1) {
      const arg = server.args[j]!
      if (arg.startsWith('-') || RUNNER_SUBCOMMANDS.has(arg)) {
        continue
      }
      tokens.add(arg)
      if (arg.includes('/') && !path.isAbsolute(arg)) {
        tokens.add(path.resolve(repoRoot, arg))
      }
      // The first program token names the server; later args are options.
      break
    }
    if (tokens.size > 0) {
      signatures.set(name, [...tokens])
    }
  }
  return signatures
}

/**
 * Parse `ps -axww -o pid=,ppid=,command=` output. `-ww` matters: without it
 * macOS ps truncates command lines to terminal width and hides the tokens
 * signatures match on.
 */
export function parseProcessTable(out: string): ProcessEntry[] {
  const parsed: ProcessEntry[] = []
  const lines = out.split('\n')
  // ^\s*(\d+) — pid; ps right-aligns it with leading spaces. \s+(\d+) — ppid.
  // \s+(.*)$ — the rest of the line is the full command with its args.
  const rowRegExp = /^\s*(\d+)\s+(\d+)\s+(.*)$/
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = lines[i]!.match(rowRegExp)
    if (!match) {
      continue
    }
    parsed.push({
      command: match[3]!,
      pid: Number(match[1]),
      ppid: Number(match[2]),
    })
  }
  return parsed
}

/**
 * The start pid plus every ancestor up to init. Killing an ancestor kills
 * this script mid-cleanup, so the whole chain — not just the parent — is
 * excluded from candidacy (wrapper shells can quote matching tokens in
 * their own command lines). The visited set doubles as a cycle guard.
 */
export function collectAncestorPids(
  entries: readonly ProcessEntry[],
  startPid: number,
): Set<number> {
  const parentByPid = new Map<number, number>()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    parentByPid.set(entries[i]!.pid, entries[i]!.ppid)
  }
  const ancestors = new Set<number>()
  let pid: number | undefined = startPid
  while (pid !== undefined && pid > 0 && !ancestors.has(pid)) {
    ancestors.add(pid)
    pid = parentByPid.get(pid)
  }
  return ancestors
}

/**
 * Widen a set of root pids to include every live descendant — the spawned
 * browsers/helpers that actually hold listen ports and profile locks.
 */
export function collectWithDescendants(
  entries: readonly ProcessEntry[],
  roots: ReadonlySet<number>,
): Set<number> {
  const childrenByPpid = new Map<number, number[]>()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const siblings = childrenByPpid.get(entry.ppid)
    if (siblings) {
      siblings.push(entry.pid)
    } else {
      childrenByPpid.set(entry.ppid, [entry.pid])
    }
  }
  const collected = new Set<number>(roots)
  const queue = [...roots]
  while (queue.length > 0) {
    const pid = queue.pop()!
    const children = childrenByPpid.get(pid) ?? []
    for (let i = 0, { length } = children; i < length; i += 1) {
      const child = children[i]!
      if (!collected.has(child)) {
        collected.add(child)
        queue.push(child)
      }
    }
  }
  return collected
}

/**
 * Select the candidate stale processes: command line contains any server
 * signature, pid is outside the excluded self-plus-ancestors set, and the
 * process is not this script itself.
 */
export function selectCandidates(
  entries: readonly ProcessEntry[],
  signatures: readonly string[],
  excluded: ReadonlySet<number>,
): ProcessEntry[] {
  return entries.filter(entry => {
    if (excluded.has(entry.pid)) {
      return false
    }
    if (entry.command.includes('mcp-reset')) {
      return false
    }
    return signatures.some(signature => entry.command.includes(signature))
  })
}

/**
 * Parse `lsof -F pn` field output (`p<pid>` / `n<value>` lines) into a
 * pid → values map. Covers both `-d cwd`, where the value is the working
 * directory, and `-iTCP -sTCP:LISTEN`, where it is the listen address.
 */
export function parseLsofFields(out: string): Map<number, string[]> {
  const valuesByPid = new Map<number, string[]>()
  let currentPid: number | undefined
  const lines = out.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('p')) {
      currentPid = Number(line.slice(1))
      if (!valuesByPid.has(currentPid)) {
        valuesByPid.set(currentPid, [])
      }
    } else if (line.startsWith('n') && currentPid !== undefined) {
      valuesByPid.get(currentPid)!.push(line.slice(1))
    }
  }
  return valuesByPid
}

/**
 * Extract the numeric port from an lsof listen-address value
 * (`*:9222`, `127.0.0.1:9222`, `[::1]:9222`).
 */
export function parseListenPort(address: string): number | undefined {
  const port = Number(address.slice(address.lastIndexOf(':') + 1))
  return Number.isInteger(port) && port > 0 ? port : undefined
}

function runForStdout(command: string, args: string[]): string {
  const result = spawnSync(command, args, { stdioString: true })
  // Non-zero exit — e.g. lsof with no matches — is a valid empty answer here,
  // not an error — the callers treat "nothing found" as such.
  return typeof result.stdout === 'string'
    ? result.stdout
    : String(result.stdout ?? '')
}

function readProcessTable(): ProcessEntry[] {
  return parseProcessTable(
    runForStdout('ps', ['-axww', '-o', 'pid=,ppid=,command=']),
  )
}

/**
 * Working directories for a batch of pids. Empty map when lsof is
 * unavailable or every pid is gone.
 */
function readCwds(pids: readonly number[]): Map<number, string[]> {
  if (pids.length === 0) {
    return new Map()
  }
  return parseLsofFields(
    runForStdout('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-F', 'pn']),
  )
}

/**
 * TCP listen ports currently held by a batch of pids.
 */
function readListenPorts(pids: readonly number[]): Map<number, number[]> {
  if (pids.length === 0) {
    return new Map()
  }
  const fields = parseLsofFields(
    runForStdout('lsof', [
      '-a',
      '-p',
      pids.join(','),
      '-iTCP',
      '-sTCP:LISTEN',
      '-P',
      '-n',
      '-F',
      'pn',
    ]),
  )
  const portsByPid = new Map<number, number[]>()
  for (const [pid, addresses] of fields) {
    const ports = addresses
      .map(parseListenPort)
      .filter((port): port is number => port !== undefined)
    if (ports.length > 0) {
      portsByPid.set(pid, ports)
    }
  }
  return portsByPid
}

function listenersOnPort(port: number): number[] {
  const out = runForStdout('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
  return out.split('\n').filter(Boolean).map(Number)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function trySignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // ESRCH — already gone; EPERM — surfaces as a survivor below.
  }
}

/**
 * SIGTERM the set, give it a shutdown grace window (browsers remove their
 * own singleton state on clean exit), then SIGKILL stragglers. Returns the
 * pids that refused to die.
 */
async function killPids(pids: readonly number[]): Promise<number[]> {
  for (let i = 0, { length } = pids; i < length; i += 1) {
    trySignal(pids[i]!, 'SIGTERM')
  }
  const deadline = Date.now() + 5000
  let survivors = pids.filter(isAlive)
  while (survivors.length > 0 && Date.now() < deadline) {
    await sleep(250)
    survivors = survivors.filter(isAlive)
  }
  for (let i = 0, { length } = survivors; i < length; i += 1) {
    trySignal(survivors[i]!, 'SIGKILL')
  }
  await sleep(500)
  return survivors.filter(isAlive)
}

export async function main(): Promise<void> {
  const servers = parseCanonicalMcpConfig(
    readFileSync(path.join(REPO_ROOT, '.mcp.json'), 'utf8'),
  )
  const signaturesByServer = deriveServerSignatures(servers, REPO_ROOT)
  const signatures = [...signaturesByServer.values()].flat()
  logger.info(
    `Servers: ${[...signaturesByServer.keys()].join(', ') || '(none)'}`,
  )

  const entries = readProcessTable()
  const excluded = collectAncestorPids(entries, process.pid)
  const candidates = selectCandidates(entries, signatures, excluded)

  // cwd scoping: only processes rooted in THIS repo are ours to kill. A
  // sibling checkout runs the same fleet servers with identical command
  // lines; its sessions must survive. Candidates whose cwd is unreadable are
  // skipped, conservatively, and logged.
  const cwds = readCwds(candidates.map(candidate => candidate.pid))
  const ours: ProcessEntry[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    const cwd = cwds.get(candidate.pid)?.[0]
    if (cwd === REPO_ROOT || cwd?.startsWith(`${REPO_ROOT}${path.sep}`)) {
      ours.push(candidate)
    } else {
      logger.warn(
        `Skipping pid ${candidate.pid} (cwd ${cwd ?? 'unreadable'} is outside this repo): ${candidate.command.slice(0, 100)}`,
      )
    }
  }

  if (ours.length === 0) {
    logger.success('No stale MCP processes for this repo.')
    return
  }

  const killSet = collectWithDescendants(
    entries,
    new Set(ours.map(entry => entry.pid)),
  )
  const portsByPid = readListenPorts([...killSet])
  const heldPorts = [...new Set([...portsByPid.values()].flat())]

  const dryRun = process.argv.includes('--dry-run')
  const verb = dryRun ? 'Would kill' : 'Killing'
  for (let i = 0, { length } = ours; i < length; i += 1) {
    const entry = ours[i]!
    logger.info(`${verb} pid ${entry.pid}: ${entry.command.slice(0, 120)}`)
  }
  const descendantCount = killSet.size - ours.length
  if (descendantCount > 0) {
    logger.info(`Including ${descendantCount} descendant process(es).`)
  }
  if (dryRun) {
    logger.success(
      `Dry run: ${killSet.size} process(es) and port(s) ${heldPorts.join(', ') || '(none)'} would be reclaimed.`,
    )
    return
  }

  const unkillable = await killPids([...killSet])
  if (unkillable.length > 0) {
    throw new Error(
      `Could not kill pid(s) ${unkillable.join(', ')} — kill them manually and re-run.`,
    )
  }

  for (let i = 0, { length } = heldPorts; i < length; i += 1) {
    const port = heldPorts[i]!
    const holders = listenersOnPort(port)
    if (holders.length > 0) {
      logger.warn(
        `Port ${port} still held by pid(s) ${holders.join(', ')}; killing.`,
      )
      const stuck = await killPids(holders)
      if (stuck.length > 0) {
        throw new Error(
          `Could not free port ${port} (pid(s) ${stuck.join(', ')}).`,
        )
      }
    }
    logger.success(`Port ${port} is free.`)
  }

  logger.success(
    `Killed ${killSet.size} process(es). Reconnect in the client (/mcp in Claude Code).`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "kills this repo's stale .mcp.json stdio server trees and frees their ports",
  help: `Usage: pnpm run mcp:reset [flags]

  --dry-run  report the processes and ports that would be reclaimed without signalling`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
