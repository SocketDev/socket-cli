/**
 * @file Keyless local AI seam — the fleet-side wrapper for the `odai` CLI
 *   from SocketDev/odai. odai runs single-shot tasks against
 *   on-device backends — Gemini Nano through headless Chrome, a loopback
 *   llama-server, Apple FoundationModels, or its deterministic simulator —
 *   with no ANTHROPIC_API_KEY involved. The CLI's exit-code contract is the
 *   whole integration surface: 0 = success with a JSON result on stdout,
 *   69 = no backend available, which callers treat as a CLEAN SKIP, never a
 *   failure. That keeps every consumer fail-open by construction: a machine
 *   without Chrome, without a llama-server, without the CLI itself simply
 *   skips the assist.
 *   Scoped-rules doctrine: the assist is a PER-REPO opt-in via the
 *   `ai.localAssist` field of `.config/repo/socket-wheelhouse.json`, never a
 *   silent fleet-wide flip. The seam admits the task families the odai bench
 *   shows small local models passing reliably — the summary class and, as
 *   of odai 0.2.1, the extract-then-decide decision class (classify-deps,
 *   weekly-update), singly or via `runOdaiBatch` over one backend launch;
 *   code-repair legs stay bench-gated on a real-engine run and are NOT
 *   routed here.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

import { loadSocketWheelhouseConfig } from '../paths.mts'

/**
 * The odai CLI's clean-skip exit code — sysexits EX_UNAVAILABLE. A consumer
 * that sees it skips its AI leg and never fails the job.
 */
export const ODAI_SKIP_EXIT = 69

/**
 * The single-shot odai subcommands this seam admits: the summary class plus
 * the benched decision family (extract-then-decide with best-of-N and
 * constrained decoding, admitted as of odai 0.2.1). The `patch` task exists
 * CLI-side but stays bench-gated behind a real llama-server engine run, so
 * it is deliberately not listed.
 */
export type OdaiTask =
  | 'classify-deps'
  | 'commit-msg'
  | 'summarize'
  | 'triage'
  | 'weekly-update'

/**
 * One odai run's outcome. `skipped` covers every environment gap — no bin,
 * no backend — and is never an error; `failed` is a real model/task failure
 * the caller may log before falling back to its deterministic path.
 */
export type OdaiRun =
  | { readonly outcome: 'ok'; readonly value: unknown }
  | { readonly outcome: 'skipped'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

/**
 * Resolve a runnable odai binary: the `ODAI_BIN` env override when it
 * points at an existing file, else `odai` on PATH. Returns undefined when
 * neither resolves — a machine without odai installed skips the assist by
 * construction. Install `@socketsecurity/odai` from npm for a global `odai`,
 * or set `ODAI_BIN` to a local build.
 */
export function resolveOdaiBin(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = env['ODAI_BIN']
  if (explicit) {
    return existsSync(explicit) ? explicit : undefined
  }
  // whichSync returns string[] under its `all` option; single-hit mode here,
  // so anything non-string reads as absent.
  const found = whichSync('odai')
  return typeof found === 'string' ? found : undefined
}

/**
 * Whether the repo at `repoRoot` opted into the keyless local assist via
 * `ai.localAssist: true` in `.config/repo/socket-wheelhouse.json`. Default
 * false — absence of the config, the block, or the field all read as
 * opted-out, so no repo gains an AI call it didn't ask for.
 */
export function localAssistEnabled(repoRoot: string): boolean {
  const loaded = loadSocketWheelhouseConfig(repoRoot)
  if (!loaded) {
    return false
  }
  const ai = loaded.value['ai']
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) {
    return false
  }
  return (ai as Record<string, unknown>)['localAssist'] === true
}

/**
 * One odai invocation's runtime knobs, shared by `spawnOdai` and `runOdai`.
 */
export interface RunOdaiConfig {
  readonly bin: string
  readonly cwd: string
  readonly timeoutMs: number
}

/**
 * One raw odai spawn's outcome: the stdout text on exit 0, else the mapped
 * skip/failure. `spawnOdai` layers single-JSON parsing on top; `runOdaiBatch`
 * layers JSONL parsing.
 */
export type OdaiSpawnRaw =
  | { readonly outcome: 'ok'; readonly stdout: string }
  | { readonly outcome: 'skipped'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

/**
 * Spawn one odai invocation (`args[0]` is the subcommand) and map the CLI's
 * exit-code contract: an errno-style spawn failure or exit 69 reads as
 * `skipped`, any other non-zero exit as `failed`, exit 0 returns the raw
 * stdout. Appends `--timeout` from `timeoutMs` — the CLI's own per-prompt
 * budget — while `spawnBudgetMs` is the hard process backstop (wider than
 * the prompt budget so backend launch overhead never eats it and the CLI's
 * own timeout message wins the race). Never throws.
 */
export async function spawnOdaiRaw(
  args: readonly string[],
  config: RunOdaiConfig,
  spawnBudgetMs: number,
): Promise<OdaiSpawnRaw> {
  const { bin, cwd, timeoutMs } = {
    __proto__: null,
    ...config,
  } as RunOdaiConfig
  const task = args[0] ?? 'run'
  let code: number
  let stdout: string
  let stderr: string
  try {
    const r = await spawn(bin, [...args, '--timeout', String(timeoutMs)], {
      cwd,
      stdioString: true,
      timeout: spawnBudgetMs,
    })
    code = r.code
    stdout = typeof r.stdout === 'string' ? r.stdout : ''
    stderr = typeof r.stderr === 'string' ? r.stderr : ''
  } catch (e) {
    if (!isSpawnError(e)) {
      return { outcome: 'failed', reason: errorMessage(e) }
    }
    // An errno-style string code — EACCES, ENOENT — means the bin itself is
    // not runnable: an environment gap on par with a missing backend, so it
    // reads as a clean skip, never a model/task failure.
    if (typeof e.code === 'string') {
      return {
        outcome: 'skipped',
        reason: `odai bin not runnable: ${e.code}`,
      }
    }
    code = e.code
    stdout = typeof e.stdout === 'string' ? e.stdout : ''
    stderr = typeof e.stderr === 'string' ? e.stderr : ''
  }
  if (code === ODAI_SKIP_EXIT) {
    return {
      outcome: 'skipped',
      reason: firstLine(stderr) || 'no odai backend available',
    }
  }
  if (code !== 0) {
    return {
      outcome: 'failed',
      reason: `odai ${task} exited ${code}: ${firstLine(stderr)}`,
    }
  }
  return { outcome: 'ok', stdout }
}

/**
 * Spawn one odai invocation and parse its stdout as a single JSON value.
 * Exit-code mapping is `spawnOdaiRaw`'s. Never throws.
 */
export async function spawnOdai(
  args: readonly string[],
  config: RunOdaiConfig,
): Promise<OdaiRun> {
  const raw = await spawnOdaiRaw(args, config, config.timeoutMs + 30_000)
  if (raw.outcome !== 'ok') {
    return raw
  }
  try {
    return { outcome: 'ok', value: JSON.parse(raw.stdout) }
  } catch {
    return {
      outcome: 'failed',
      reason: `odai ${args[0] ?? 'run'} printed unparseable JSON`,
    }
  }
}

/**
 * Run one single-shot odai task with `input` as its text payload and a hard
 * timeout. The payload travels via a temp file and `--input` — never argv,
 * which would leak diff content into the process table. Exit-code mapping is
 * `spawnOdai`'s. Never throws.
 */
export async function runOdai(
  task: OdaiTask,
  input: string,
  config: RunOdaiConfig,
): Promise<OdaiRun> {
  let tmpDir: string | undefined
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'fleet-odai-'))
    const inputPath = path.join(tmpDir, 'input.txt')
    await writeFile(inputPath, input, 'utf8')
    return await spawnOdai([task, '--input', inputPath], config)
  } catch (e) {
    return { outcome: 'failed', reason: errorMessage(e) }
  } finally {
    if (tmpDir) {
      await safeDelete(tmpDir).catch(() => undefined)
    }
  }
}

/**
 * One task in an odai batch manifest. `input` as an object is serialized by
 * the CLI into exactly what the task's single-shot stdin would carry.
 */
export interface OdaiBatchEntry {
  readonly id: string
  readonly input: string | Record<string, unknown>
  readonly task: OdaiTask
}

/**
 * One batch task's result line, as the CLI reports it: failures are in-band
 * per task and never fail the batch.
 */
export type OdaiBatchLine =
  | { readonly id: string; readonly ok: true; readonly value: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string }

/**
 * One batch run's outcome. `skipped` and `failed` mirror OdaiRun; `ok`
 * carries every task's result line in manifest order.
 */
export type OdaiBatchRun =
  | { readonly outcome: 'ok'; readonly lines: readonly OdaiBatchLine[] }
  | { readonly outcome: 'skipped'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

/**
 * Run many odai tasks over ONE backend launch (`odai batch`, CLI >= 0.2.1).
 * The manifest travels via a temp JSONL file and `--input` — never argv.
 * `timeoutMs` is the PER-TASK budget (the CLI's semantic); the spawn
 * backstop scales with the entry count so a long batch is never killed by a
 * single-task budget. Exit 69 maps to `skipped` (no backend — the whole
 * batch clean-skips); per-task failures come back in-band as ok:false
 * lines. Never throws.
 */
export async function runOdaiBatch(
  entries: readonly OdaiBatchEntry[],
  config: RunOdaiConfig,
): Promise<OdaiBatchRun> {
  if (entries.length === 0) {
    return { outcome: 'skipped', reason: 'empty batch — nothing to run' }
  }
  let tmpDir: string | undefined
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'fleet-odai-'))
    const manifestPath = path.join(tmpDir, 'manifest.jsonl')
    await writeFile(
      manifestPath,
      `${entries.map(e => JSON.stringify(e)).join('\n')}\n`,
      'utf8',
    )
    const raw = await spawnOdaiRaw(
      ['batch', '--input', manifestPath],
      config,
      config.timeoutMs * entries.length + 30_000,
    )
    if (raw.outcome !== 'ok') {
      return raw
    }
    const lines: OdaiBatchLine[] = []
    const rawLines = raw.stdout.split('\n')
    for (let i = 0, { length } = rawLines; i < length; i += 1) {
      const line = rawLines[i]!
      if (line.trim() === '') {
        continue
      }
      try {
        lines.push(JSON.parse(line) as OdaiBatchLine)
      } catch {
        return {
          outcome: 'failed',
          reason: 'odai batch printed an unparseable result line',
        }
      }
    }
    return { outcome: 'ok', lines }
  } catch (e) {
    return { outcome: 'failed', reason: errorMessage(e) }
  } finally {
    if (tmpDir) {
      await safeDelete(tmpDir).catch(() => undefined)
    }
  }
}

/**
 * First non-empty line of a diagnostic blob, capped for log hygiene. Pure.
 */
function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0)
  return (line ?? '').slice(0, 200)
}
