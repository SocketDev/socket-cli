/**
 * @file Shared seams + defaults for the per-ecosystem setup steps
 *   (`setup-brew`, `setup-go`, `setup-python`, `setup-rust`). Each step is
 *   self-detecting: it no-ops with a clear skip line when its ecosystem is
 *   absent or the platform does not apply, and otherwise installs ONLY through
 *   the locked/soaked artifact the fleet already pins (a soaked Homebrew tap
 *   pin, the committed `Cargo.lock` / `go.sum` / `uv.lock`). The spawn +
 *   command-lookup side effects live behind the injectable seams defined here,
 *   so the unit tests drive every step without installing anything or touching
 *   the network. Fleet doctrine: a dev machine provisions exactly what CI gets,
 *   through the same locked artifacts.
 */

import { accessSync, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

import type { Logger } from '@socketsecurity/lib-stable/logger/logger'

/**
 * Options for a single `runCommand` spawn. `silent` suppresses echoing the
 * captured child output to this process's streams (used for probe commands
 * whose stdout is parsed, not shown).
 */
export interface RunCommandOptions {
  readonly cwd?: string | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly silent?: boolean | undefined
}

/**
 * The structured result of a `runCommand` spawn. `exitCode` is 0 on success and
 * the child's non-zero code (or 1 for a spawn failure) otherwise — a step reads
 * this to fail loud rather than throwing.
 */
export interface RunCommandResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

/**
 * The spawn seam every step installs through. Injectable so tests record the
 * argv a step WOULD run without spawning a real process.
 */
export type RunCommand = (
  command: string,
  args: readonly string[],
  options?: RunCommandOptions | undefined,
) => Promise<RunCommandResult>

/**
 * The PATH-lookup seam a step uses to decide whether a required tool is
 * present. Injectable so tests force the present/absent branch
 * deterministically.
 */
export type CommandExists = (command: string) => boolean | Promise<boolean>

/**
 * The seams + context a per-ecosystem step accepts. Every field is optional and
 * defaults (via `resolveEcosystemOptions`) to the real implementation, so the
 * wizard calls a step with no args while tests inject each seam.
 */
export interface EcosystemStepOptions {
  readonly commandExists?: CommandExists | undefined
  readonly logger?: Logger | undefined
  readonly platform?: NodeJS.Platform | undefined
  readonly repoRoot?: string | undefined
  readonly runCommand?: RunCommand | undefined
}

/**
 * The outcome of a step. `skipped` is true when the ecosystem/platform did not
 * apply (still `ok`); `ok` is false only when a required tool was missing or an
 * install command failed loud.
 */
export interface EcosystemStepResult {
  readonly ok: boolean
  readonly reason?: string | undefined
  readonly skipped: boolean
}

/**
 * The seams with every default filled in.
 */
export interface ResolvedEcosystemOptions {
  readonly commandExists: CommandExists
  readonly logger: Logger
  readonly platform: NodeJS.Platform
  readonly repoRoot: string
  readonly runCommand: RunCommand
}

/**
 * Fill every unset seam with its real default: PATH lookup, the shared logger,
 * this process's platform, the repo root, and the lib-spawn runner.
 */
export function resolveEcosystemOptions(
  options?: EcosystemStepOptions | undefined,
): ResolvedEcosystemOptions {
  const opts = options ?? {}
  return {
    commandExists: opts.commandExists ?? defaultCommandExists,
    logger: opts.logger ?? getDefaultLogger(),
    platform: opts.platform ?? process.platform,
    repoRoot: opts.repoRoot ?? REPO_ROOT,
    runCommand: opts.runCommand ?? defaultRunCommand,
  }
}

/**
 * The default `runCommand`: spawn via the fleet lib `spawn`, capture stdout +
 * stderr, echo them through (unless `silent`), and normalize the exit into a
 * `RunCommandResult`. lib `spawn` throws on a non-zero exit, so the catch maps
 * that to the child's `code`.
 */
export async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options?: RunCommandOptions | undefined,
): Promise<RunCommandResult> {
  const opts = options ?? {}
  try {
    const result = await spawn(command, [...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
      stdioString: true,
    })
    const stdout = String(result.stdout ?? '')
    const stderr = String(result.stderr ?? '')
    if (!opts.silent) {
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    }
    return { exitCode: 0, stderr, stdout }
  } catch (e) {
    const err = e as {
      code?: number | undefined
      stderr?: string | undefined
      stdout?: string | undefined
    }
    const stdout = String(err.stdout ?? '')
    const stderr = String(err.stderr ?? '')
    if (!opts.silent) {
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    }
    return { exitCode: err.code ?? 1, stderr, stdout }
  }
}

/**
 * The default `commandExists`: scan `PATH` for an executable entry named
 * `command` (honoring `PATHEXT` on Windows). Pure over the environment — no
 * child process — so it never runs the tool it is probing for.
 */
export function defaultCommandExists(command: string): boolean {
  const pathVar = process.env['PATH'] ?? ''
  if (pathVar === '') {
    return false
  }
  const exts =
    process.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : ['']
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir === '') {
      continue
    }
    for (const ext of exts) {
      try {
        accessSync(path.join(dir, `${command}${ext}`), fsConstants.X_OK)
        return true
      } catch {
        // Not executable here; keep scanning the remaining PATH entries.
      }
    }
  }
  return false
}

/**
 * Log a one-line skip with its reason and return the standard skipped-but-ok
 * result. A skip is a success — the ecosystem simply did not apply.
 */
export function skipResult(
  logger: Logger,
  step: string,
  reason: string,
): EcosystemStepResult {
  logger.log(`${step} — skipped: ${reason}`)
  return { ok: true, reason, skipped: true }
}
