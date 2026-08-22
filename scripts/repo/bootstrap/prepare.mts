#!/usr/bin/env node
/*
 * @file Dep-0 fleet "prepare doctor". The consumer's `prepare` lifecycle runs
 *   this AFTER pnpm installs root deps (npm runs `prepare` post-install) — the
 *   only point where the fetched fleet payload exists AND the package manager
 *   is available, so it is where a thin member self-heals its wiring:
 *
 *   1. Fetch + apply the pinned fleet bundle when the consumer isn't current
 *      (delegates to `scripts/repo/bootstrap/fleet.mjs --if-current`). On a fresh clone this
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
 *      surface grows. USAGE: node scripts/repo/bootstrap/prepare.mts
 */

// Dep-0 bare-node fetcher (documented invariant: never imports in-repo
// socket-lib): shells out to pnpm via node:child_process, and execFileSync's
// throw-on-nonzero gates the reconcile step — the lib spawn wrapper (async,
// non-throwing) would re-plumb the error handling.
// oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 bare-node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// Function declarations hoist, so the sorted-position definition below is
// usable here.
const REPO_ROOT = resolveRepoRoot(HERE)

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
 *
 * Guards against downgrading a newer applied pack: `maybeNotifyUpdate` (which
 * runs AFTER this in `runPrepare`) opportunistically applies the newest ref it
 * resolves, but does NOT update the config pin. Without this guard, the next
 * install's `fleet.mjs --if-current` sees `appliedRef !== pinnedRef` and
 * re-applies the OLD pin, reverting the auto-update — wasted work every cycle.
 * The guard skips the fetch when the applied ref is at or ahead of the pin, so
 * a newer applied pack is never downgraded to the pin outside CI. CI behavior
 * is unchanged: `maybeNotifyUpdate` is suppressed there, so the applied ref
 * always matches the pin and the guard is never consulted.
 */
export function fetchBundle(): void {
  const fleet = path.join(HERE, 'fleet.mjs')
  if (!existsSync(fleet)) {
    log('no scripts/repo/bootstrap/fleet.mjs beside me — skipping bundle fetch')
    return
  }
  // The PRODUCER branch. A checkout carrying `template/base` holds the canon
  // locally: there is no bundle to fetch and no pin to compare, so it
  // materializes from its own template instead. Everything after this step —
  // the pnpm-workspace repair and the reconcile install — is identical, and is
  // exactly what a producer needs too: the mirrors it just placed include ~380
  // workspace package.json files that the first install could not see.
  // Branching here rather than writing a second doctor keeps one code path.
  if (existsSync(path.join(REPO_ROOT, 'template', 'base'))) {
    if (!tryRun('node', [fleet, '--from-template'])) {
      log(
        'materialize (fleet.mjs --from-template) reported a problem — continuing',
      )
    }
    return
  }
  const pinnedRef = readPinnedRef(REPO_ROOT)
  const appliedRef = readAppliedRefLocal(REPO_ROOT)
  if (isAppliedRefCurrentOrNewer(pinnedRef, appliedRef)) {
    log(
      `bundle ${appliedRef} already applied (at or ahead of pin ${pinnedRef}) — skipping fetch`,
    )
    return
  }
  if (!tryRun('node', [fleet, '--if-current'])) {
    log('bundle fetch (fleet.mjs --if-current) reported a problem — continuing')
  }
}

/**
 * Settings file candidates, in priority order. Mirrors the fetcher's own
 * `resolveSettingsPath` list so `readPinnedRef` reads the same file
 * `fleet.mjs --if-current` does.
 */
const SETTINGS_CANDIDATES_LOCAL = [
  '.config/repo/socket-wheelhouse.json',
  '.config/socket-wheelhouse.json', // loose-config-ref: allow -- migration read
  '.socket-wheelhouse.json',
] as const

/**
 * The applied-ref marker path. Mirrors the fetcher's `APPLIED_MARKER` so
 * `readAppliedRefLocal` reads the same file `fleet.mjs` writes after a
 * successful apply.
 */
const APPLIED_MARKER_PATH = '.cache/fleet/socket-wheelhouse/bundle-applied'

/**
 * True when the applied ref is newer-or-equal to the pinned ref — the applied
 * pack is at or ahead of the pin, so `--if-current` must NOT downgrade it.
 *
 * Resolves ancestry via a sibling wheelhouse checkout when one exists (the same
 * `git merge-base --is-ancestor` path the stale-template guard in `fleet.mjs`
 * uses, but checking whether the PIN is an ancestor of the APPLIED ref). When
 * no sibling checkout is available (a thin member), ancestry cannot be proven
 * without a network call, so this falls back to trusting the applied ref:
 * outside CI the only writer that diverges the applied ref from the pin is
 * `maybeNotifyUpdate`, which exclusively applies newer refs, so a divergent
 * applied ref is newer by construction. In CI `maybeNotifyUpdate` is
 * suppressed, so the applied ref always matches the pin and this function is
 * never consulted.
 */
export function isAppliedRefCurrentOrNewer(
  pinnedRef: string | undefined,
  appliedRef: string | undefined,
): boolean {
  if (!pinnedRef || !appliedRef) {
    return false
  }
  if (appliedRef === pinnedRef) {
    return true
  }
  const pinnedSha = packTemplateShaLocal(pinnedRef)
  const appliedSha = packTemplateShaLocal(appliedRef)
  if (!pinnedSha || !appliedSha) {
    return false
  }
  const wheelhouse = path.join(REPO_ROOT, '..', 'socket-wheelhouse')
  if (existsSync(path.join(wheelhouse, '.git'))) {
    try {
      execFileSync(
        'git',
        ['merge-base', '--is-ancestor', pinnedSha, appliedSha],
        {
          cwd: wheelhouse,
          stdio: 'ignore',
        },
      )
      return true
    } catch {
      return false
    }
  }
  return !process.env['CI']
}

export function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry)
  } catch {
    return false
  }
}

export function log(message: string): void {
  // Dep-0 bootstrap prepare doctor runs on a bare clone with no node_modules:
  // cannot import the lib logger; console.log writes to STDOUT.
  // oxlint-disable-next-line socket/no-console-prefer-logger -- dep-0 bootstrap
  console.log(`fleet-prepare: ${message}`)
}

/**
 * How long a release-freshness lookup stays good. Mirrors the fetcher's own
 * notice throttle (24h) and shares its store, so the network call and the
 * display are gated by ONE window instead of the call running every time and
 * the display being throttled after the fact.
 */
const NOTICE_CHECK_TTL_MS = 864e5

/**
 * Opportunistic update: when this cheaply learns a newer release exists, it
 * APPLIES that ref and then fires the throttled boxed notice on STDERR via the
 * fetcher's own notice machinery.
 *
 * Checking and then telling the operator to go re-cascade left every member
 * stale until somebody acted on a message, so the check does the update it
 * discovered. `fetchBundle` still applies the PINNED ref on every install; this
 * is what moves the pin forward.
 *
 * Best-effort throughout: offline, no gh, or a failed apply is swallowed so a
 * `pnpm install` never breaks on it, and the run continues.
 *
 * The CI-suppress, opt-out, and 24h throttle are checked BEFORE the GitHub
 * lookup, so they gate the apply as well as the display: no CI runner updates
 * itself, an opted-out operator is never touched, and no member updates more
 * than once a day.
 */
export async function maybeNotifyUpdate(): Promise<void> {
  const fleet = path.join(HERE, 'fleet.mjs')
  if (!existsSync(fleet)) {
    return
  }
  try {
    const {
      UPDATE_NOTIFIER_OPT_OUT_ENV,
      maybeShowUpdateNotice,
      readBundleConfig,
      readNoticeStore,
      resolveNewestRef,
    } =
      // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- dep-0 bootstrap resolves the fetcher lazily; a static import would execute it on every prepare run
      (await import(pathToFileURL(fleet).href)) as {
        UPDATE_NOTIFIER_OPT_OUT_ENV: string
        maybeShowUpdateNotice: (o: {
          dest: string
          updateAvailable: boolean
          newestRef: string | undefined
        }) => boolean
        readBundleConfig: (dest: string) => {
          ref: string | undefined
          cascadeSha: string | undefined
        }
        readNoticeStore: (
          dest: string,
        ) =>
          | { lastCheckMs: number; lastSeenRef: string | undefined }
          | undefined
        resolveNewestRef: (repo: string) => string | undefined
      }
    const cfg = readBundleConfig(REPO_ROOT)
    if (!cfg.ref) {
      return
    }
    // Gate the NETWORK CALL, not just the display. `resolveNewestRef` hits the
    // GitHub API, and the CI-suppress / opt-out / 24h throttle inside
    // `shouldShowNotice` ran AFTER it — so every `pnpm install`, in every CI
    // job, paid for an API call whose result was then discarded. At fleet
    // scale that is the shape that earns a rate limit.
    //
    // In CI and under the opt-out nothing may be applied or printed, so the
    // call is pure waste and is skipped outright. Otherwise honor the same 24h
    // window the display uses.
    //
    // The tradeoff is deliberate: a release cut inside the window is not picked
    // up until the window closes. That costs freshness, never correctness — the
    // PINNED bundle is still applied on every install by `fetchBundle`
    // (`fleet.mjs --if-current`), in CI and locally alike, so a member is never
    // running unverified or half-applied scaffolding while it waits.
    if (process.env['CI'] || process.env[UPDATE_NOTIFIER_OPT_OUT_ENV]) {
      return
    }
    const store = readNoticeStore(REPO_ROOT)
    if (
      store !== undefined &&
      Date.now() - store.lastCheckMs < NOTICE_CHECK_TTL_MS
    ) {
      return
    }
    const repo = 'SocketDev/socket-wheelhouse'
    const newestRef = resolveNewestRef(repo)
    if (newestRef === undefined || newestRef === cfg.ref) {
      return
    }
    // A newer tag exists than the pinned ref, so APPLY it rather than only
    // saying so. A notice naming a re-cascade the operator has to run by hand is
    // a to-do item: it costs a read on every install and the member stays stale
    // until somebody acts on it.
    //
    // Safe because the apply is the SAME verified path `fetchBundle` uses —
    // every file's SHA-256 checked against the manifest, nothing written unless
    // the whole set matches — so applying a newer ref is no riskier than
    // applying the pinned one.
    //
    // Everything that gates the LOOKUP gates the apply: CI, the opt-out env, and
    // the 24h window are all checked above. So this cannot fire on a CI runner,
    // cannot fire for an operator who opted out, and cannot fire more than once
    // a day. The notice still prints, now reporting what happened rather than
    // what to go do.
    const applied = tryRun('node', [fleet, '--ref', newestRef])
    if (!applied) {
      log(`bundle update to ${newestRef} reported a problem — continuing`)
    }
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
 * Extract the template SHA from a fleet-pack ref (`fleet-pack-<40-hex-sha>`).
 * Mirrors the fetcher's `packTemplateSha` so this file stays dep-0 (no
 * `fleet.mjs` import for a pure string parse). Returns undefined when the ref
 * is not a valid pack ref.
 */
function packTemplateShaLocal(ref: string): string | undefined {
  return /^fleet-pack-(?<sha>[0-9a-f]{40})$/.exec(ref)?.groups?.['sha']
}

/**
 * Read the applied ref from the marker file. Returns undefined when no marker
 * exists. Mirrors the fetcher's `readAppliedRef` so `fetchBundle` can compare
 * without importing the fetcher module.
 */
function readAppliedRefLocal(dest: string): string | undefined {
  const p = path.join(dest, APPLIED_MARKER_PATH)
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : undefined
}

/**
 * Read the pinned `bundle.ref` from the first settings file that exists.
 * Returns undefined when no settings file is found or it has no `bundle.ref`.
 * Mirrors the fetcher's `readBundleRef` so `fetchBundle` can compare without
 * importing the fetcher module.
 */
function readPinnedRef(dest: string): string | undefined {
  for (let i = 0, { length } = SETTINGS_CANDIDATES_LOCAL; i < length; i += 1) {
    const p = path.join(dest, SETTINGS_CANDIDATES_LOCAL[i]!)
    if (!existsSync(p)) {
      continue
    }
    try {
      const json = JSON.parse(readFileSync(p, 'utf8')) as {
        bundle?: { ref?: string | undefined } | undefined
      }
      return json.bundle?.ref
    } catch {
      return undefined
    }
  }
  return undefined
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

// The dep-0 doctor lives at <repo-root>/scripts/repo/bootstrap/ (three levels
// deep), so walk up to the nearest package.json ancestor rather than assuming a
// fixed depth — the same repo-root rule as scripts/fleet/paths.mts
// resolveRepoRoot, kept dep-0 (node: builtins only). `fleet.mjs` sits beside
// this file, so HERE (not REPO_ROOT) is used to locate it.
export function resolveRepoRoot(startDir: string): string {
  let cur = startDir
  const { root } = path.parse(cur)
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  return path.resolve(startDir, '..', '..', '..')
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

// Realpath both sides: Node resolves the REAL path for `import.meta.url`
// while `process.argv[1]` keeps the path as invoked, so a bare URL equality
// silently skips the CLI body under a symlinked invocation.
if (isMainModule()) {
  // Dep-0 ESM CLI run via node, never CJS-bundled.
  // oxlint-disable-next-line socket/no-top-level-await -- dep-0 ESM CLI run
  process.exitCode = await runPrepare()
}
