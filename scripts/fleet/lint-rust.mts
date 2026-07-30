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
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findWorkspaceManifests } from './_shared/cargo-workspaces.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'

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

function main(): void {
  const repoRoot = REPO_ROOT
  const manifests = findWorkspaceManifests(repoRoot)
  if (!manifests.length) {
    logger.info('lint-rust: no Cargo.toml found; nothing to lint.')
    return
  }
  let failed = false
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const manifest = manifests[i]!
    logger.info(
      `lint-rust: cargo clippy --workspace (${path.relative(repoRoot, manifest)})`,
    )
    const result = spawnSync('cargo', buildCargoClippyArgs(manifest, { fix }), {
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

if (isMainModule(import.meta.url)) {
  main()
}
