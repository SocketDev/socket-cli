/*
 * @file Code-as-law DRY: the fleet's Rust toolchain pin lives in ONE canonical
 *   place — `rust-toolchain.toml`'s `channel` — and every other copy is DERIVED
 *   from it, never hand-synced. Three copies exist because rustup / the docker
 *   prebake / the cargo soak updater each read a different surface:
 *
 *   1. `<repo>/rust-toolchain.toml` `channel` — the CANONICAL pin (rustup reads
 *      it; build-prebakes.mts injects it as RUST_VERSION). Single source.
 *   2. `template/base/rust-toolchain.toml` `channel` — the pin cascaded to Rust
 *      members (wheelhouse-only; absent in members).
 *   3. `RUST_UPDATER_TOOLCHAIN` in scripts/fleet/update/cargo.mts — the nightly
 *      the cargo soak updater runs on, unified onto the build pin so there is
 *      NO separate updater-only nightly (`-Zmin-publish-age` is nightly-only).
 *      This check asserts 2 + 3 equal 1; `--fix` rewrites the derived copies
 *      from the canonical channel. Fails the gate on drift, with What / Where /
 *      Saw-vs-wanted / Fix. No-ops when the repo has no `rust-toolchain.toml`
 *      (a JS-only member has nothing to sync). Wired into the check gate +
 *      cascade (--fix). Usage: node
 *      scripts/fleet/check/rust-toolchain-pins-are-synced.mts [--fix]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Capture a rust-toolchain.toml `channel = "…"` line as (prefix, value, close-quote)
// so a fix can splice a new pin while preserving surrounding whitespace/quoting.
const CHANNEL_RE = /^(\s*channel\s*=\s*")([^"]+)(")/m
// Capture the `RUST_UPDATER_TOOLCHAIN = '…'` assignment the same way (prefix, value, close-quote).
const UPDATER_RE = /(RUST_UPDATER_TOOLCHAIN\s*=\s*')([^']+)(')/

/**
 * The `channel = "…"` value from a `rust-toolchain.toml`, or undefined when the
 * file has no channel line (malformed / not a toolchain file).
 */
export function parseRustChannel(toml: string): string | undefined {
  const m = CHANNEL_RE.exec(toml)
  return m?.[2]
}

/**
 * Rewrite the `channel = "…"` value in a `rust-toolchain.toml`, preserving the
 * surrounding whitespace + quotes (and the rest of the file byte-for-byte).
 * Returns the input unchanged when there is no channel line to rewrite.
 */
export function withRustChannel(toml: string, channel: string): string {
  return toml.replace(CHANNEL_RE, `$1${channel}$3`)
}

/**
 * The `RUST_UPDATER_TOOLCHAIN = '…'` value from cargo.mts, or undefined when
 * the constant is absent.
 */
export function parseUpdaterToolchain(cargoMts: string): string | undefined {
  const m = UPDATER_RE.exec(cargoMts)
  return m?.[2]
}

/**
 * Rewrite the `RUST_UPDATER_TOOLCHAIN = '…'` value in cargo.mts, leaving the
 * rest byte-for-byte. Returns the input unchanged when the constant is absent.
 */
export function withUpdaterToolchain(
  cargoMts: string,
  channel: string,
): string {
  return cargoMts.replace(UPDATER_RE, `$1${channel}$3`)
}

export interface RunCheckOptions {
  fix?: boolean | undefined
}

interface Drift {
  where: string
  saw: string
  next: string
  path: string
}

/**
 * Assert the derived Rust-pin copies (template/base rust-toolchain.toml +
 * RUST_UPDATER_TOOLCHAIN in cargo.mts) match the canonical
 * `<repoRoot>/rust-toolchain.toml` channel. `options.fix` rewrites the drifted
 * copies; otherwise a drift fails the gate. Returns the intended exit code
 * (0 = synced / no rust-toolchain.toml, 1 = malformed canonical or drift in
 * check mode).
 */
export function runCheck(
  repoRoot: string,
  options?: RunCheckOptions | undefined,
): number {
  const opts = { __proto__: null, ...options } as RunCheckOptions
  const fix = opts.fix === true
  const canonicalPath = path.join(repoRoot, 'rust-toolchain.toml')
  if (!existsSync(canonicalPath)) {
    // No Rust in this repo — nothing to sync (JS-only member).
    return 0
  }
  const canonical = parseRustChannel(readFileSync(canonicalPath, 'utf8'))
  if (!canonical) {
    logger.fail(
      [
        '[rust-toolchain-pins-are-synced] Canonical rust-toolchain.toml has no `channel`.',
        '',
        `  Where: ${canonicalPath}`,
        '  Wanted: a `channel = "<toolchain>"` line to sync the other pins from.',
        '',
      ].join('\n'),
    )
    return 1
  }
  const drifts: Drift[] = []
  // Derived copy 1: the members' cascaded toolchain (wheelhouse-only).
  const templateToml = path.join(
    repoRoot,
    'template',
    'base',
    'rust-toolchain.toml',
  )
  if (existsSync(templateToml)) {
    const content = readFileSync(templateToml, 'utf8')
    const saw = parseRustChannel(content)
    if (saw && saw !== canonical) {
      drifts.push({
        where: 'template/base/rust-toolchain.toml `channel`',
        saw,
        next: withRustChannel(content, canonical),
        path: templateToml,
      })
    }
  }
  // Derived copy 2: the cargo soak updater's nightly.
  const cargoMts = path.join(
    repoRoot,
    'scripts',
    'fleet',
    'update',
    'cargo.mts',
  )
  if (existsSync(cargoMts)) {
    const content = readFileSync(cargoMts, 'utf8')
    const saw = parseUpdaterToolchain(content)
    if (saw && saw !== canonical) {
      drifts.push({
        where: 'RUST_UPDATER_TOOLCHAIN (scripts/fleet/update/cargo.mts)',
        saw,
        next: withUpdaterToolchain(content, canonical),
        path: cargoMts,
      })
    }
  }
  if (drifts.length === 0) {
    return 0
  }
  if (fix) {
    for (let i = 0, { length } = drifts; i < length; i += 1) {
      writeFileSync(drifts[i]!.path, drifts[i]!.next)
    }
    logger.success(
      `[rust-toolchain-pins-are-synced] Synced ${drifts.length} Rust pin(s) to "${canonical}".`,
    )
    return 0
  }
  logger.fail(
    [
      '[rust-toolchain-pins-are-synced] Rust toolchain pin(s) drifted from the canonical rust-toolchain.toml.',
      '',
      `  Canonical: ${canonicalPath} → "${canonical}"`,
      '  Drifted:',
      ...drifts.map(
        d => `    - ${d.where}: saw "${d.saw}", wanted "${canonical}"`,
      ),
      '',
      '  Fix: bump the pin in rust-toolchain.toml (the ONE source), then run',
      '  `node scripts/fleet/check/rust-toolchain-pins-are-synced.mts --fix`',
      '  (the cascade does this automatically).',
      '',
    ].join('\n'),
  )
  return 1
}

function main(): void {
  const { values } = parseArgs({
    options: { fix: { default: false, type: 'boolean' } },
    strict: false,
  })
  process.exitCode = runCheck(REPO_ROOT, { fix: !!values['fix'] })
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
}
