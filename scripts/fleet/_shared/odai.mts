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
 *   silent fleet-wide flip. Only summary-class tasks — the scenario family
 *   the odai bench shows small local models passing reliably — are wired
 *   through this seam; code-repair legs stay bench-gated on a real-engine
 *   run and are NOT routed here.
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
 * The single-shot odai subcommands this seam admits. Summary-class only —
 * the `patch` task exists CLI-side but stays bench-gated behind a real
 * llama-server engine run, so it is deliberately not listed.
 */
export type OdaiTask = 'commit-msg' | 'summarize' | 'triage'

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

export interface RunOdaiConfig {
  readonly bin: string
  readonly cwd: string
  readonly timeoutMs: number
}

/**
 * Run one single-shot odai task with `input` as its text payload and a hard
 * timeout. The payload travels via a temp file and `--input` — never argv,
 * which would leak diff content into the process table. Exit 0 parses the
 * stdout JSON; exit 69 maps to `skipped`; anything else, including a timeout
 * or an unparseable reply, maps to `failed`. Never throws.
 */
export async function runOdai(
  task: OdaiTask,
  input: string,
  config: RunOdaiConfig,
): Promise<OdaiRun> {
  const { bin, cwd, timeoutMs } = {
    __proto__: null,
    ...config,
  } as RunOdaiConfig
  let tmpDir: string | undefined
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'fleet-odai-'))
    const inputPath = path.join(tmpDir, 'input.txt')
    await writeFile(inputPath, input, 'utf8')
    let code: number
    let stdout: string
    let stderr: string
    try {
      // `--timeout` is the CLI's own per-prompt budget; the spawn timeout is
      // a hard backstop set 30s wider so backend launch overhead never eats
      // the prompt budget and the CLI's own timeout message wins the race.
      const r = await spawn(
        bin,
        [task, '--input', inputPath, '--timeout', String(timeoutMs)],
        { cwd, stdioString: true, timeout: timeoutMs + 30_000 },
      )
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
    try {
      return { outcome: 'ok', value: JSON.parse(stdout) }
    } catch {
      return {
        outcome: 'failed',
        reason: `odai ${task} printed unparseable JSON`,
      }
    }
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
