/**
 * @file Owning linter for a repo's first-party Rust: run `cargo clippy` for
 *   every cargo workspace in the tree, skipping vendored/generated code. The
 *   root clippy.toml plus each crate's `[lints]` table govern every run, and
 *   `-D warnings` makes a lint a failure. Modes:
 *   node scripts/fleet/lint-rust.mts         # verify (CI / pre-push)
 *   node scripts/fleet/lint-rust.mts --fix   # apply clippy's autofixes
 *   Verify is the default and `--fix` is the mutating mode, matching
 *   `scripts/fleet/lint.mts`; the format twin `fmt-rust.mts` inverts that
 *   (rewrite by default, `--check` to verify) because a formatter's job IS the
 *   rewrite. A Cargo.toml nested under another discovered manifest's directory
 *   is a workspace member — `cargo clippy --workspace` at the outer root
 *   already covers it, so only the outermost manifests run.
 *   This is the SANCTIONED path for clippy: `no-direct-linter-guard` blocks a
 *   bare `cargo clippy` inside a fleet repo, and this runner is what its block
 *   message names.
 */

// prefer-async-spawn: sync-required — sequential CLI gates, exit-code
// aggregation.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findWorkspaceManifests } from './_shared/cargo-workspaces.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import { CARGO_FIXIT_VERSION } from './_shared/rust-tool-pins.mts'
import { REPO_ROOT } from './paths.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const fix = process.argv.includes('--fix')

/**
 * The `cargo clippy` argv for one workspace manifest. Pure + exported so a test
 * asserts the `--fix` toggle without spawning cargo.
 *
 * `--all-targets` reaches tests, benches, and examples, not just the lib/bin —
 * the same surface CI lints. `-D warnings` after the `--` separator promotes
 * every remaining lint to an error so a warning cannot ride into main. A fix
 * run adds `--allow-dirty --allow-staged`: clippy refuses to rewrite a repo
 * with uncommitted changes otherwise, and the fleet's whole working model is
 * an agent fixing a dirty tree.
 */
export function buildCargoClippyArgs(
  manifest: string,
  options?: { fix?: boolean | undefined } | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    fix?: boolean | undefined
  }
  return [
    'clippy',
    '--workspace',
    '--all-targets',
    '--manifest-path',
    manifest,
    ...(opts.fix ? ['--fix', '--allow-dirty', '--allow-staged'] : []),
    '--',
    '-D',
    'warnings',
  ]
}

/**
 * The `cargo fixit` argv for one workspace manifest — the drop-in, much
 * faster replacement for `cargo clippy --fix` (crate-ci/cargo-fixit; it
 * skips the full re-check compile between fix rounds). Same coverage flags
 * as {@link buildCargoClippyArgs}'s fix mode; the pinned install lives in
 * `setup/rust.mts` via `_shared/rust-tool-pins.mts`. Pure + exported for
 * tests.
 */
export function buildCargoFixitArgs(manifest: string): string[] {
  return [
    'fixit',
    '--clippy',
    '--workspace',
    '--all-targets',
    '--manifest-path',
    manifest,
    '--allow-dirty',
    '--allow-staged',
  ]
}

/**
 * Whether the `cargo fixit` subcommand answers on this machine. A probe, not
 * a gate: a repo without the tool still fixes through clippy's own `--fix`,
 * one `pnpm run setup:rust` slower.
 */
export function cargoFixitAvailable(): boolean {
  const probe = spawnSync('cargo', ['fixit', '--version'], { stdio: 'pipe' })
  return probe.status === 0
}

/**
 * The channel pinned for a workspace, or undefined when nothing pins it.
 *
 * Walks UP from the workspace to `stopDir` (the repo root), because that is
 * exactly how cargo and rustup resolve `rust-toolchain.toml` — nearest wins,
 * and a repo-root pin covers every workspace that does not ship its own. A
 * lookup that only checked the workspace directory would report a repo whose
 * root pin IS being honored as unpinned, which is a scarier message than the
 * truth and would push someone to copy the pin file into every workspace.
 */
export function readPinnedChannel(
  manifestDir: string,
  stopDir?: string | undefined,
): string | undefined {
  const root = path.resolve(stopDir ?? REPO_ROOT)
  let dir = path.resolve(manifestDir)
  // Bound the walk: stop after the repo root, and never loop at the fs root.
  for (;;) {
    const file = path.join(dir, 'rust-toolchain.toml')
    if (existsSync(file)) {
      const match = /^\s*channel\s*=\s*["']([^"']+)["']/m.exec(
        readFileSync(file, 'utf8'),
      )
      if (match) {
        return match[1]
      }
    }
    if (dir === root) {
      return undefined
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

/**
 * Spawn args that pin clippy to the toolchain the repo declares.
 *
 * A bare `cargo clippy` is NOT pinned. `cargo` resolves the `clippy`
 * subcommand by searching PATH for `cargo-clippy`, so whichever one comes
 * first wins — a Homebrew install shadows rustup's, and the pin is silently
 * ignored. That produced a gate that passed locally on a stable clippy while
 * CI failed on the pinned nightly's newer lints, TWICE in one session
 * (`useless_borrows_in_formatting`, `question_mark`), because the local run
 * was not linting with the compiler the repo declares.
 *
 * `rustup run <channel>` resolves cargo AND its cargo-clippy from that
 * toolchain's own bin dir, so PATH order cannot decide which linter runs.
 * Falls back to bare `cargo` when rustup or the pin is missing, and says so —
 * an unpinned lint is a weaker gate and must never look like the pinned one.
 */
export function buildPinnedSpawn(
  manifestDir: string,
  cargoArgs: readonly string[],
  stopDir?: string | undefined,
): { args: string[]; command: string; pinned: boolean } {
  const channel = readPinnedChannel(manifestDir, stopDir)
  if (!channel) {
    return { args: [...cargoArgs], command: 'cargo', pinned: false }
  }
  return {
    args: ['run', channel, 'cargo', ...cargoArgs],
    command: 'rustup',
    pinned: true,
  }
}

export function main(): void {
  const repoRoot = REPO_ROOT
  const manifests = findWorkspaceManifests(repoRoot)
  if (!manifests.length) {
    logger.info('lint-rust: no Cargo.toml found; nothing to lint.')
    return
  }
  let failed = false
  // A fix run prefers cargo-fixit (pinned at CARGO_FIXIT_VERSION by
  // setup:rust) — the drop-in replacement that skips the re-check compile
  // between fix rounds — and falls back to clippy's own --fix without it.
  const useFixit = fix && cargoFixitAvailable()
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const manifest = manifests[i]!
    const manifestDir = path.dirname(manifest)
    const spawnPlan = buildPinnedSpawn(
      manifestDir,
      useFixit
        ? buildCargoFixitArgs(manifest)
        : buildCargoClippyArgs(manifest, { fix }),
    )
    logger.info(
      `lint-rust: cargo ${useFixit ? `fixit --clippy (cargo-fixit@${CARGO_FIXIT_VERSION})` : 'clippy'} --workspace (${path.relative(repoRoot, manifest)})${
        spawnPlan.pinned ? '' : ' [UNPINNED — no rust-toolchain.toml channel]'
      }`,
    )
    const result = spawnSync(spawnPlan.command, spawnPlan.args, {
      // Cargo/rustup discover rust-toolchain.toml and .cargo/config.toml from
      // cwd, not from --manifest-path. Run at the workspace so a nested pin or
      // target config is honored consistently.
      cwd: path.dirname(manifest),
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      failed = true
    }
  }
  if (failed) {
    logger.fail(
      fix
        ? 'lint-rust: cargo clippy --fix failed.'
        : 'lint-rust: clippy findings. Fix: node scripts/fleet/lint-rust.mts --fix (clippy autofixes only; the rest are hand fixes).',
    )
    process.exitCode = 1
    return
  }
  logger.info('lint-rust: clean.')
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'runs cargo clippy over every first-party cargo workspace in the tree',
  help: `Usage: node scripts/fleet/lint-rust.mts [flags]

  --fix  apply clippy's machine-applicable autofixes`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
