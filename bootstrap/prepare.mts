#!/usr/bin/env node
/*
 * @file Dep-0 fleet "prepare doctor". The consumer's `prepare` lifecycle runs
 *   this AFTER pnpm installs root deps (npm runs `prepare` post-install) — the
 *   only point where the fetched fleet payload exists AND the package manager
 *   is available, so it is where a thin member self-heals its wiring:
 *
 *   1. Fetch + apply the pinned fleet bundle when the consumer isn't current
 *      (delegates to `bootstrap/fleet.mjs --if-current`). On a fresh clone this
 *      materializes the untracked fleet payload — the per-hook and oxlint-rule
 *      workspace packages the first install couldn't see.
 *   2. Repair `pnpm-workspace.yaml`: ensure every fleet workspace dir is listed
 *      under `packages:` so pnpm resolves those now-present packages.
 *      Idempotent — a no-op once the consumer already carries them.
 *   3. `pnpm install --ignore-scripts` — a reconcile pass that links the
 *      freshly-materialized workspace packages into node_modules. The FIRST
 *      install ran before the payload existed; this pass is what wires it.
 *      `--ignore-scripts` stops the pass from re-entering `prepare` (which
 *      would loop) and is safe because fleet packages have no build step. Bare
 *      node only — the dep-0 bootstrap never imports socket-lib (documented +
 *      enforced; everything else in the fleet uses socket-lib). Each repair is
 *      a pure, unit-tested function; this file orchestrates them and shells
 *      out. Extend it with further check-and-repair steps as the wired-settings
 *      surface grows. USAGE: node bootstrap/prepare.mts
 */

// oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 bare-node fetcher (documented invariant: never imports in-repo socket-lib): shells out to pnpm via node:child_process, and execFileSync's throw-on-nonzero gates the reconcile step — the lib spawn wrapper (async, non-throwing) would re-plumb the error handling.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(HERE, '..')

/**
 * Fleet workspace package globs every member lists under `pnpm-workspace.yaml`
 * `packages:`. They resolve the (fetched, gitignored) fleet payload packages —
 * the per-hook dirs and the oxlint-rule ("rules") sub-packages. This is the
 * dep-0 doctor's source of truth; the bundle's workspace segment seeds the same
 * set on fetch, and this re-asserts them on every prepare so a drifted or
 * freshly-cloned consumer self-heals.
 */
export const FLEET_WORKSPACE_PACKAGES: readonly string[] = [
  '.claude/hooks/fleet/*',
  '.claude/hooks/repo/*',
  '.config/fleet/oxlint-plugin/fleet/*',
  '.config/repo/oxlint-plugin/*',
]

/**
 * Ensure every glob in `required` appears under the `packages:` block of a
 * `pnpm-workspace.yaml`. Pure + idempotent: returns the YAML unchanged when all
 * are present, else appends the missing entries at the end of the existing
 * block (preserving order + the 2-space single-quoted bullet style). Creates a
 * `packages:` block at the top when the file has none. Repo-specific entries
 * already in the block are preserved.
 */
export function ensureWorkspacePackages(
  yaml: string,
  required: readonly string[],
): string {
  const lines = yaml.split('\n')
  const blockIdx = lines.findIndex(l => l.trimEnd() === 'packages:')
  const present = new Set<string>()
  // Index to splice missing bullets at: right AFTER the last existing bullet
  // (so they join the list, not land past a trailing blank line / comment).
  let insertAt = -1
  if (blockIdx !== -1) {
    insertAt = blockIdx + 1
    for (let i = blockIdx + 1; i < lines.length; i += 1) {
      const ln = lines[i]!
      // The block ends at the first non-indented, non-blank line.
      if (ln !== '' && !/^\s/.test(ln)) {
        break
      }
      // ^\s*-\s*        a YAML list bullet
      // ['"]?(...)['"]?  the (optionally quoted) glob value
      // \s*(?:#.*)?$     optional trailing inline comment
      const m = /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(ln)
      if (m) {
        present.add(m[1]!)
        insertAt = i + 1
      }
    }
  }
  const missing = required.filter(r => !present.has(r))
  if (missing.length === 0) {
    return yaml
  }
  const bullets = missing.map(m => `  - '${m}'`)
  if (blockIdx === -1) {
    return [`packages:`, ...bullets, '', ...lines].join('\n')
  }
  return [
    ...lines.slice(0, insertAt),
    ...bullets,
    ...lines.slice(insertAt),
  ].join('\n')
}

/**
 * Step 1: fetch + apply the pinned bundle when not current (best-effort).
 */
export function fetchBundle(): void {
  const fleet = path.join(HERE, 'fleet.mjs')
  if (!existsSync(fleet)) {
    log('no bootstrap/fleet.mjs beside me — skipping bundle fetch')
    return
  }
  if (!tryRun('node', [fleet, '--if-current'])) {
    log('bundle fetch (fleet.mjs --if-current) reported a problem — continuing')
  }
}

export function log(message: string): void {
  logger.log(`fleet-prepare: ${message}`)
}

/**
 * Opportunistic passive update notice (update-notifier style). Runs the
 * read-only status verb capturing JSON; when it cheaply learns a newer release
 * exists it fires the throttled boxed notice on STDERR via the fetcher's own
 * notice machinery. Best-effort: any failure (offline, no gh) is swallowed so a
 * `pnpm install` never breaks on it. The notice NAMES the re-cascade. Honors
 * the throttle / CI-suppress / opt-out / NO_COLOR inside the fetcher.
 */
export async function maybeNotifyUpdate(): Promise<void> {
  const fleet = path.join(HERE, 'fleet.mjs')
  if (!existsSync(fleet)) {
    return
  }
  try {
    const { maybeShowUpdateNotice, readBundleConfig, resolveNewestRef } =
      // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- dep-0 bootstrap resolves the fetcher lazily; a static import would execute it on every prepare run
      (await import(pathToFileURL(fleet).href)) as {
        maybeShowUpdateNotice: (o: {
          dest: string
          updateAvailable: boolean
          newestRef: string | undefined
        }) => boolean
        readBundleConfig: (dest: string) => {
          ref: string | undefined
          cascadeSha: string | undefined
        }
        resolveNewestRef: (repo: string) => string | undefined
      }
    const cfg = readBundleConfig(REPO_ROOT)
    if (!cfg.ref) {
      return
    }
    const repo = 'SocketDev/socket-wheelhouse'
    const newestRef = resolveNewestRef(repo)
    if (newestRef === undefined || newestRef === cfg.ref) {
      return
    }
    // Cheap signal: a NEWER tag exists than the pinned ref. We don't re-verify
    // templateSha here (that's `fleet:status`' job) — the notice is passive.
    maybeShowUpdateNotice({
      dest: REPO_ROOT,
      newestRef,
      updateAvailable: true,
    })
  } catch {
    // Best-effort: offline / no gh / a status hard-fail never breaks install.
  }
}

/**
 * Step 3: reconcile install so the now-present workspace packages link in.
 */
export function reconcileInstall(): boolean {
  // --ignore-scripts keeps this pass from re-entering `prepare` (a loop); fleet
  // packages have no build step, so skipping lifecycle scripts loses nothing.
  return tryRun('pnpm', ['install', '--ignore-scripts'], {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
  })
}

/**
 * Step 2: repair `pnpm-workspace.yaml` `packages:` to list the fleet dirs.
 */
export function repairWorkspacePackages(): void {
  const wsPath = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(wsPath)) {
    log('no pnpm-workspace.yaml — skipping workspace repair')
    return
  }
  const before = readFileSync(wsPath, 'utf8')
  const after = ensureWorkspacePackages(before, FLEET_WORKSPACE_PACKAGES)
  if (after !== before) {
    writeFileSync(wsPath, after)
    log('repaired pnpm-workspace.yaml packages: (added missing fleet dirs)')
  }
}

/**
 * Run the doctor end-to-end. Returns the intended exit code (0 = healthy / all
 * repairs applied; 1 = the reconcile install failed).
 */
export async function runPrepare(): Promise<number> {
  fetchBundle()
  repairWorkspacePackages()
  if (!reconcileInstall()) {
    log('reconcile `pnpm install --ignore-scripts` failed')
    return 1
  }
  await maybeNotifyUpdate()
  return 0
}

/**
 * Run a command (stdio inherited) from the repo root. Returns true on exit 0,
 * false on any failure — the doctor logs + continues rather than aborting the
 * whole `prepare` on a best-effort step.
 */
export function tryRun(
  cmd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv | undefined,
): boolean {
  try {
    execFileSync(cmd, args as string[], {
      cwd: REPO_ROOT,
      env: env ?? process.env,
      stdio: 'inherit',
    })
    return true
  } catch {
    return false
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // socket-lint: allow top-level-await -- dep-0 ESM CLI run via node, never CJS-bundled
  process.exitCode = await runPrepare()
}
