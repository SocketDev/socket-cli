#!/usr/bin/env node
/*
 * @file Checkpoint helper for the security runbook skills (scanning-vulns,
 *   triaging-findings, threat-modeling, patching-findings).
 *
 *   Called via Bash from within a skill so phase state and final output land on
 *   disk in small, atomic chunks instead of one large Write tool call. A fresh
 *   skill session can then resume from the last completed phase without
 *   re-asking interviews or re-spawning verifiers.
 *
 *     save   <state_dir> <N> [<name>] --from F [--key K]  -> <K><N>.json + progress.json
 *     shard  <state_dir> <shard_id> --from F              -> shard_<id>.json; shards_done += id
 *     done   <state_dir> <N> [--key K]                    -> progress.json status=complete
 *     load   <state_dir>                                  -> progress.json to stdout
 *     append <output_file> --from F                       -> appended (creates if absent)
 *     reset  <state_dir>                                  -> rm -rf state dir
 *
 *   Three safety properties, preserved from the reference Python implementation:
 *
 *   1. Atomic writes (tmp + rename) so a kill mid-write never leaves a partial
 *      file that breaks resume.
 *   2. Path confinement: every target path must resolve under CHECKPOINT_ROOT
 *      (default cwd). The Bash permission is a prefix wildcard, so a
 *      prompt-injected agent could otherwise point append/reset at ~/.ssh,
 *      ~/.bashrc, etc. Confining to cwd keeps the blast radius at the repo
 *      being scanned.
 *   3. Payload always comes from `--from <file>` (written via the Write tool),
 *      never stdin or heredoc: target-derived strings in a heredoc could
 *      collide with the delimiter and break out to shell. With --from, no
 *      repo-derived bytes touch the Bash argv.
 *
 *   `--key` defaults to "phase" (scanning-vulns, triaging-findings,
 *   patching-findings). Pass `--key stage` for threat-modeling bootstrap.
 *   progress.json schema:
 *     {"status": "running"|"complete", "<key>_done": N, "shards_done": [...], "updated": iso}
 *
 *   Ported from `.claude/skills/_lib/checkpoint.py` in
 *   anthropics/defending-code-reference-harness (Apache-2.0); reimplemented as
 *   an `.mts` runner per the fleet "no Python / .mts runners" tooling rule.
 *   Usage: node .claude/skills/fleet/_shared/scripts/checkpoint.mts <cmd> ...
 *
 *   Runs from a fleet repo (cwd = the repo invoking the skill; the `*-state`
 *   dir lives there, never in the read-only `--repo` being scanned), so
 *   `@socketsecurity/lib` is resolvable and status/diagnostic lines go through
 *   the fleet logger. The ONE exception is `load`, which writes raw
 *   `progress.json` to stdout: that is the resume protocol the calling skill
 *   parses back, and a logger prefix would corrupt it. `reset` confines its
 *   target to a `*-state` dir under cwd before `rmSync`.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

const logger = getDefaultLogger()

const ROOT = path.resolve(process.env['CHECKPOINT_ROOT'] ?? '.')

export type ProgressFile = {
  readonly status: 'running' | 'complete' | 'absent'
  readonly shards_done?: readonly string[] | undefined
  readonly updated?: string | undefined
  readonly [key: string]: unknown
}

/**
 * Resolve `p` and require it stays under CHECKPOINT_ROOT. When `mustEnd` is
 * set, also require the resolved basename to end with that suffix (state dirs
 * always end in `-state`). Exits with code 2 on violation.
 */
export function confinePath(p: string, mustEnd?: string | undefined): string {
  const resolved = path.resolve(p)
  const rel = path.relative(ROOT, resolved)
  const outside = rel.startsWith('..') || path.isAbsolute(rel)
  if (outside) {
    fail(`checkpoint: refusing path outside ${ROOT}: ${p}`)
  }
  if (mustEnd && !path.basename(resolved).endsWith(mustEnd)) {
    fail(`checkpoint: refusing ${p} (name must end with "${mustEnd}")`)
  }
  return resolved
}

/**
 * Reject any token that carries a path separator or `..`. Shard ids and
 * `--key` values become filename fragments, so a separator would let them
 * escape the state dir even after confinePath approved the dir itself.
 */
export function safeToken(s: string, what: string): string {
  if (s.includes('/') || s.includes(path.sep) || s.includes('..')) {
    fail(
      `checkpoint: refusing ${what} with path separators: ${JSON.stringify(s)}`,
    )
  }
  return s
}

export function atomicWrite(target: string, data: string): void {
  mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, target)
}

/**
 * Pull `--flag value` out of argv, returning the trimmed argv and the value
 * (or `fallback` when the flag is absent).
 */
export function popOpt(
  argv: readonly string[],
  flag: string,
  fallback?: string | undefined,
): { rest: string[]; value: string | undefined } {
  const i = argv.indexOf(flag)
  if (i === -1) {
    return { rest: [...argv], value: fallback }
  }
  return {
    rest: [...argv.slice(0, i), ...argv.slice(i + 2)],
    value: argv[i + 1],
  }
}

export function readPayload(src: string | undefined): string {
  if (src === undefined) {
    fail(
      'checkpoint: payload must be passed via --from <file> ' +
        '(stdin/heredoc disabled to prevent shell injection)',
    )
  }
  return readFileSync(confinePath(src), 'utf8')
}

export function readJsonPayload(src: string | undefined): string {
  const raw = readPayload(src)
  try {
    JSON.parse(raw)
  } catch (e) {
    fail(
      `checkpoint: --from ${src} is not valid JSON: ${(e as Error).message}`,
      1,
    )
  }
  return raw
}

export function writeProgress(
  stateDir: string,
  options: {
    readonly status: 'running' | 'complete'
    readonly key: string
    readonly n: number
    readonly shards: readonly string[]
  },
): void {
  const { key, n, shards, status } = {
    __proto__: null,
    ...options,
  } as typeof options
  atomicWrite(
    path.join(stateDir, 'progress.json'),
    JSON.stringify({
      status,
      [`${key}_done`]: n,
      shards_done: shards,
      updated: new Date().toISOString(),
    }),
  )
}

export function cmdSave(argv: readonly string[]): number {
  const keyPop = popOpt(argv, '--key', 'phase')
  const fromPop = popOpt(keyPop.rest, '--from')
  const rest = fromPop.rest
  if (rest.length < 2) {
    return usage('save <state_dir> <N> [<name>] --from <file> [--key K]')
  }
  const stateDir = confinePath(rest[0]!, '-state')
  const n = Number.parseInt(rest[1]!, 10)
  const key = safeToken(keyPop.value!, '--key')
  const name = rest[2] ?? `${key}${n}`
  const raw = readJsonPayload(fromPop.value)
  atomicWrite(path.join(stateDir, `${key}${n}.json`), raw)
  writeProgress(stateDir, { status: 'running', key, n, shards: [] })
  logger.log(`checkpoint: ${key} ${n} (${name}) saved -> ${stateDir}/`)
  return 0
}

export function cmdShard(argv: readonly string[]): number {
  const fromPop = popOpt(argv, '--from')
  const rest = fromPop.rest
  if (rest.length !== 2) {
    return usage('shard <state_dir> <shard_id> --from <file>')
  }
  const stateDir = confinePath(rest[0]!, '-state')
  const shardId = safeToken(rest[1]!, 'shard_id')
  const raw = readJsonPayload(fromPop.value)
  atomicWrite(path.join(stateDir, `shard_${shardId}.json`), raw)
  const progressPath = path.join(stateDir, 'progress.json')
  const prog: Record<string, unknown> = existsSync(progressPath)
    ? (JSON.parse(readFileSync(progressPath, 'utf8')) as Record<
        string,
        unknown
      >)
    : { status: 'running' }
  const shards = Array.isArray(prog['shards_done'])
    ? (prog['shards_done'] as string[])
    : []
  if (!shards.includes(shardId)) {
    shards.push(shardId)
  }
  prog['shards_done'] = shards
  prog['updated'] = new Date().toISOString()
  atomicWrite(progressPath, JSON.stringify(prog))
  logger.log(`checkpoint: shard ${shardId} saved (${shards.length} done)`)
  return 0
}

export function cmdDone(argv: readonly string[]): number {
  const keyPop = popOpt(argv, '--key', 'phase')
  const rest = keyPop.rest
  if (rest.length !== 2) {
    return usage('done <state_dir> <N> [--key K]')
  }
  writeProgress(confinePath(rest[0]!, '-state'), {
    status: 'complete',
    key: safeToken(keyPop.value!, '--key'),
    n: Number.parseInt(rest[1]!, 10),
    shards: [],
  })
  logger.log('checkpoint: complete')
  return 0
}

export function cmdLoad(argv: readonly string[]): number {
  if (argv.length !== 1) {
    return usage('load <state_dir>')
  }
  const progressPath = path.join(
    confinePath(argv[0]!, '-state'),
    'progress.json',
  )
  const progressJson = existsSync(progressPath)
    ? readFileSync(progressPath, 'utf8')
    : '{"status": "absent"}'
  // Raw stdout, not logger: this is the resume protocol — the calling skill
  // parses this exact JSON back, so a logger prefix would corrupt it.
  process.stdout.write(progressJson) // socket-lint: allow process-stdio -- machine-parsed JSON channel
  return 0
}

export function cmdAppend(argv: readonly string[]): number {
  const fromPop = popOpt(argv, '--from')
  const rest = fromPop.rest
  if (rest.length !== 1) {
    return usage('append <output_file> --from <file>')
  }
  const out = confinePath(rest[0]!)
  mkdirSync(path.dirname(out), { recursive: true })
  const chunk = readPayload(fromPop.value)
  appendFileSync(out, chunk.endsWith('\n') ? chunk : `${chunk}\n`)
  logger.log(`checkpoint: appended ${chunk.length} bytes -> ${out}`)
  return 0
}

export function cmdReset(argv: readonly string[]): number {
  if (argv.length !== 1) {
    return usage('reset <state_dir>')
  }
  const dir = confinePath(argv[0]!, '-state')
  if (existsSync(dir)) {
    rmSync(dir, { force: true, recursive: true })
    logger.log(`checkpoint: removed ${dir}/`)
  }
  return 0
}

function usage(line: string): number {
  logger.error(`usage: checkpoint.mts ${line}`)
  return 2
}

function fail(message: string, code = 2): never {
  logger.error(message)
  process.exit(code)
}

export function main(argv: readonly string[]): number {
  const cmd = argv[0]
  const rest = argv.slice(1)
  switch (cmd) {
    case 'save':
      return cmdSave(rest)
    case 'shard':
      return cmdShard(rest)
    case 'done':
      return cmdDone(rest)
    case 'load':
      return cmdLoad(rest)
    case 'append':
      return cmdAppend(rest)
    case 'reset':
      return cmdReset(rest)
    default:
      logger.error(
        'usage: checkpoint.mts {save|shard|done|load|append|reset} ...',
      )
      return 2
  }
}

process.exitCode = main(process.argv.slice(2))
