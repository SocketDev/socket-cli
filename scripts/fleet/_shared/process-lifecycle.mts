/*
 * @file Child-teardown wiring for fleet CLI entrypoints that spawn children
 *   (fix.mts, ai-lint-fix.mts). Every spawn via
 *   `@socketsecurity/lib-stable/process/spawn/child` (and `spawnAiAgent`,
 *   which spawns through the same helper) threads the lib's process-scoped
 *   `AbortSignal` into the underlying `child_process` call, so aborting that
 *   one controller sends the kill signal to every in-flight child of THIS
 *   process. Nothing wired that abort to anything by default — a killed or
 *   abandoned parent left its children running, orphaned, with no way to stop
 *   them (observed live: a `fix.mts` run kept editing files minutes after the
 *   invoking shell call had already returned control).
 *
 *   `installChildTeardown()` closes that gap: called once near the top of an
 *   entrypoint, it aborts the controller on SIGINT, SIGTERM, or normal process
 *   exit. Each process wires its OWN copy — the cascade from a top-level
 *   `fix.mts` down through the `ai-lint-fix.mts` child process down to the
 *   `claude` grandchild happens one hop per process, since the abort
 *   controller is per-process, not global across the whole tree.
 */

import process from 'node:process'

import { getAbortController } from '@socketsecurity/lib-stable/process/abort'

let installed = false

/**
 * Abort `controller` (default: this process's shared AbortController) — every
 * in-flight child this process spawned via the lib's `spawn()` receives its
 * kill signal. Takes the controller as a parameter (rather than only closing
 * over the real singleton) so tests can assert the call without touching the
 * process-wide instance every other spawn in the test run shares.
 */
export function teardownChildren(
  controller: Pick<AbortController, 'abort'> = getAbortController(),
): void {
  controller.abort()
}

export interface TeardownSeams {
  abort?: (() => void) | undefined
  exit?: ((code: number) => void) | undefined
  on?:
    | ((event: string, handler: (...args: unknown[]) => void) => void)
    | undefined
}

/**
 * Wire SIGINT/SIGTERM/exit on this process to {@link teardownChildren}, so
 * this process can never end (by signal or normal exit) while it still has a
 * live child running. Idempotent in production (a second real call is a
 * no-op); `seams` bypasses that guard so tests can re-drive the wiring
 * against fakes without mutating real process listeners or the shared
 * AbortController.
 */
export function installChildTeardown(seams?: TeardownSeams | undefined): void {
  const isTest = seams !== undefined
  if (installed && !isTest) {
    return
  }
  if (!isTest) {
    installed = true
  }
  const abort = seams?.abort ?? teardownChildren
  const exit = seams?.exit ?? ((code: number) => process.exit(code))
  const on =
    seams?.on ??
    ((event: string, handler: (...args: unknown[]) => void) =>
      process.once(event, handler))

  on('SIGINT', () => {
    abort()
    exit(130)
  })
  on('SIGTERM', () => {
    abort()
    exit(143)
  })
  on('exit', () => {
    abort()
  })
}
