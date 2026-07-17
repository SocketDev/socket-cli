#!/usr/bin/env node
/**
 * @file One-time crates.io name-reservation bootstrap. crates.io trusted
 *   publishing (OIDC) can only be CONFIGURED for a crate name that ALREADY
 *   EXISTS on the registry — but a brand-new crate has no name to configure the
 *   trusted publisher against, a chicken-and-egg. This script breaks it: it
 *   publishes a minimal `0.0.0` reservation (a standalone `Cargo.toml` + a
 *   one-line `src/lib.rs`, and nothing else) to CLAIM the name, so the OIDC
 *   trusted publisher can then be wired up on crates.io. Real releases go out via
 *   CI afterward (verified + attested) — this is the SANCTIONED one-time LOCAL
 *   publish, the only local-publish carve-out in the cargo flow.
 *   Each name assembles a fresh STANDALONE crate in a temp dir (outside any
 *   workspace) containing ONLY a Cargo.toml + src/lib.rs and runs
 *   `cargo publish --allow-dirty --manifest-path <dir>/Cargo.toml` from it. The
 *   temp dir is not a git repo, so `--allow-dirty` sidesteps cargo's VCS-dirty
 *   refusal; the build is still verified (no `--no-verify`). crates.io REQUIRES
 *   `description` + `license`, so the reservation manifest carries both.
 *   CLI: placeholder <name...> [--apply]
 *   Dry-run by default (prints the plan, publishes nothing); `--apply` performs
 *   the publish. Per-name isolation: one name failing never aborts the rest, and
 *   a summary prints at the end. Fail-soft — main() catches, logs, and sets a
 *   non-zero exit code; it never throws. The script handles no tokens — cargo
 *   reads `cargo login` / CARGO_REGISTRY_TOKEN / OIDC itself.
 *   Usage: node scripts/fleet/publish-infra/cargo/placeholder.mts my-crate\
 *   other-crate --apply
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { logger, runInherit } from '../shared.mts'

// The reservation version. Deliberately the lowest possible semver so the real
// first release (any 0.0.1+ / 0.1.0) always supersedes it as the latest.
export const PLACEHOLDER_VERSION = '0.0.0'

// The reservation crate's one-line description. crates.io REQUIRES a
// `description` to publish, so the reservation manifest always carries this.
export const PLACEHOLDER_DESCRIPTION =
  'Placeholder to reserve the name for crates.io trusted publishing. ' +
  'Real releases publish via CI (OIDC).'

export interface PlaceholderCargoTomlOptions {
  // The `description` field (crates.io requires it).
  description: string
  // The `repository` field, emitted only when provided (crates.io does not
  // require it; a standalone reservation for an arbitrary name has no reliable
  // repo URL, so it is omitted by default).
  repository?: string | undefined
}

export interface PlaceholderArgs {
  apply: boolean
  names: string[]
}

export type PlaceholderStatus = 'published' | 'planned' | 'skipped' | 'failed'

export interface PlaceholderResult {
  name: string
  status: PlaceholderStatus
  detail?: string | undefined
}

export interface RunPlaceholderOptions {
  // The publish executor. Defaults to
  // `cargo publish --allow-dirty --manifest-path <dir>/Cargo.toml` run from the
  // temp dir; injected in tests so no real registry call happens.
  publishExec?: ((dir: string) => Promise<number>) | undefined
  // Temp-dir assembler; injectable so plan tests can avoid touching disk.
  assembleDir?: ((name: string) => Promise<string>) | undefined
  // Temp-dir cleanup; injectable for the same reason.
  removeDir?: ((dir: string) => Promise<void>) | undefined
}

/**
 * Build the reservation `Cargo.toml` for `name`. Pure — a `[package]` table
 * with the name, `0.0.0`, `edition = "2021"`, the required `description` +
 * `license = "MIT"`, and an optional `repository`. crates.io requires
 * description + license, so both are always present.
 */
export function buildPlaceholderCargoToml(
  name: string,
  options: PlaceholderCargoTomlOptions,
): string {
  const opts = { __proto__: null, ...options } as PlaceholderCargoTomlOptions
  const lines = [
    '[package]',
    `name = "${name}"`,
    `version = "${PLACEHOLDER_VERSION}"`,
    'edition = "2021"',
    `description = "${opts.description}"`,
    'license = "MIT"',
  ]
  if (opts.repository) {
    lines.push(`repository = "${opts.repository}"`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * The one-line reservation `src/lib.rs` for `name`: only a `//!` inner doc
 * comment. An empty library crate builds instantly (crates.io verifies the
 * build on publish), and a `//!` comment keeps the file non-empty +
 * self-describing. Pure. Trailing newline so the file is POSIX-clean.
 */
export function buildPlaceholderLibRs(name: string): string {
  return (
    `//! Placeholder crate reserving \`${name}\` on crates.io for trusted\n` +
    '//! publishing. Real releases publish via CI (OIDC trusted publishing).\n'
  )
}

/**
 * A pragmatic crates.io crate-name gate: length 1–64, characters
 * `[a-zA-Z0-9_-]`, must start with a letter. The registry is the final arbiter
 * (reserved names, keyword collisions, `-`/`_` equivalence) — this only skips
 * OBVIOUSLY invalid names before we bother assembling + publishing them. Pure.
 */
export function isValidCrateName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) {
    return false
  }
  if (name.trim() !== name) {
    return false
  }
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
}

/**
 * Create a fresh temp dir under `tmpBase` (defaults to the OS temp dir) holding
 * EXACTLY the reservation's `Cargo.toml` + `src/lib.rs`, and return its path.
 * The caller owns cleanup (see runPlaceholder's finally). `tmpBase` is
 * injectable for hermetic tests.
 */
export async function assemblePlaceholderDir(
  name: string,
  tmpBase: string = os.tmpdir(),
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpBase, 'socket-cargo-placeholder-'))
  await fs.writeFile(
    path.join(dir, 'Cargo.toml'),
    buildPlaceholderCargoToml(name, { description: PLACEHOLDER_DESCRIPTION }),
    'utf8',
  )
  const srcDir = path.join(dir, 'src')
  await fs.mkdir(srcDir)
  await fs.writeFile(
    path.join(srcDir, 'lib.rs'),
    buildPlaceholderLibRs(name),
    'utf8',
  )
  return dir
}

// Default publish executor: the sanctioned one-time LOCAL publish. Runs
// `cargo publish --allow-dirty --manifest-path <dir>/Cargo.toml` from the
// assembled temp dir with inherited stdio so any auth prompt reaches the
// operator's terminal. `--allow-dirty` sidesteps the VCS-dirty refusal (the
// temp dir is not a git repo); the build is still verified (no `--no-verify`).
async function defaultPublishExec(dir: string): Promise<number> {
  return await runInherit(
    'cargo',
    [
      'publish',
      '--allow-dirty',
      '--manifest-path',
      path.join(dir, 'Cargo.toml'),
    ],
    dir,
  )
}

async function defaultRemoveDir(dir: string): Promise<void> {
  await fs.rm(dir, { force: true, recursive: true })
}

/**
 * One-line human summary of the run: counts by status, tagged with the mode.
 * Pure — exported for tests.
 */
export function formatSummary(
  results: readonly PlaceholderResult[],
  apply: boolean,
): string {
  const count = (status: PlaceholderStatus): number =>
    results.filter(r => r.status === status).length
  return (
    `Placeholder ${apply ? 'publish' : 'dry-run'} summary: ` +
    `${count('published')} published, ${count('planned')} planned, ` +
    `${count('skipped')} skipped, ${count('failed')} failed.`
  )
}

/**
 * Reserve each name, isolated. For every name: validate it (invalid → skipped),
 * assemble its temp dir, then either PRINT the plan (dry-run) or run the
 * publish (`--apply`). A thrown error or non-zero publish exit for one name is
 * recorded as `failed` and never aborts the others; every assembled dir is
 * cleaned up. Logs a summary and returns the per-name results (for tests + the
 * caller's exit-code decision).
 */
export async function runPlaceholder(
  args: PlaceholderArgs,
  options?: RunPlaceholderOptions | undefined,
): Promise<PlaceholderResult[]> {
  const opts = { __proto__: null, ...options } as RunPlaceholderOptions
  const assembleDir = opts.assembleDir ?? assemblePlaceholderDir
  const publishExec = opts.publishExec ?? defaultPublishExec
  const removeDir = opts.removeDir ?? defaultRemoveDir
  const { apply, names } = args

  const results: PlaceholderResult[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (!isValidCrateName(name)) {
      logger.warn(`Skipping invalid crate name: ${JSON.stringify(name)}`)
      results.push({
        name,
        status: 'skipped',
        detail: 'invalid crate name',
      })
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const dir = await assembleDir(name)
      try {
        if (!apply) {
          logger.log(
            `[dry-run] ${name}@${PLACEHOLDER_VERSION} — would run ` +
              `\`cargo publish --allow-dirty\` from ${dir} ` +
              `(Cargo.toml + src/lib.rs only). Re-run with --apply to publish.`,
          )
          results.push({ name, status: 'planned' })
          continue
        }
        logger.log(
          `Publishing reservation ${name}@${PLACEHOLDER_VERSION} to crates.io…`,
        )
        // eslint-disable-next-line no-await-in-loop
        const code = await publishExec(dir)
        if (code === 0) {
          logger.success(
            `Reserved ${name}@${PLACEHOLDER_VERSION}. Configure the OIDC ` +
              `trusted publisher on crates.io, then release via CI.`,
          )
          results.push({ name, status: 'published' })
        } else {
          logger.fail(`cargo publish exited ${code} for ${name}.`)
          results.push({
            name,
            status: 'failed',
            detail: `cargo publish exited ${code}`,
          })
        }
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await removeDir(dir)
      }
    } catch (e) {
      logger.error(`${name}: ${errorMessage(e)}`)
      results.push({ name, status: 'failed', detail: errorMessage(e) })
    }
  }

  logger.log('')
  logger.log(formatSummary(results, apply))
  return results
}

/**
 * Parse `placeholder <name...> [--apply]`. Dry-run is the default (no
 * `--apply`). Positional args are crate names. Exits (usage error) on an
 * unknown flag, or when no names are given. (crates.io has no per-package
 * access flag, so there is no `--access` here.)
 */
export function parseArgs(argv: readonly string[]): PlaceholderArgs {
  let apply = false
  const names: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
    } else if (arg.startsWith('-')) {
      logger.fail(`Unknown flag: ${arg}`)
      process.exit(1)
    } else {
      names.push(arg)
    }
  }
  if (names.length === 0) {
    logger.fail('Usage: placeholder <name...> [--apply]')
    process.exit(1)
  }
  return { apply, names }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  logger.log(
    `crates.io placeholder reservation — ${args.names.length} name(s)` +
      `${args.apply ? ' [apply]' : ' [dry-run]'}`,
  )
  const results = await runPlaceholder(args)
  if (results.some(r => r.status === 'failed')) {
    process.exitCode = 1
  }
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the CLI.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
