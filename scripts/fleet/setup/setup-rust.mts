#!/usr/bin/env node
/**
 * @file `setup:rust` — provision the Rust toolchain and fetch crates through
 *   the locked path, so a dev machine gets exactly what CI gets.
 *   Self-detecting: skips with a clear line unless the repo has a first-party
 *   `Cargo.toml`. Requires `rustup` (it never `curl | sh` — it fails loud with
 *   the install instruction), requires and installs the nearest
 *   `rust-toolchain.toml` pin (including components + targets), then runs
 *   `cargo fetch --locked` per manifest dir so the
 *   dependency set is exactly the soaked `Cargo.lock`.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findOwnCargoManifests } from '../update/cargo.mts'
import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type {
  EcosystemStepOptions,
  EcosystemStepResult,
} from './ecosystems.mts'

const mainLogger = getDefaultLogger()

/**
 * Extract the pinned toolchain channel from a `rust-toolchain.toml` body — the
 * `channel = "…"` key under the `[toolchain]` table. Also tolerates a legacy
 * bare-channel file (the whole trimmed body is the channel, e.g. `1.96.1`).
 * Returns undefined when no channel is declared.
 */
export function parseRustToolchainPin(tomlText: string): string | undefined {
  let inToolchain = false
  const lines = tomlText.split(/\r?\n/)
  for (let index = 0, { length } = lines; index < length; index += 1) {
    const rawLine = lines[index]!
    const line = (rawLine.split('#')[0] ?? '').trim()
    if (line === '') {
      continue
    }
    const section = /^\[([^\]]+)\]$/.exec(line)
    if (section) {
      inToolchain = section[1]!.trim() === 'toolchain'
      continue
    }
    if (inToolchain) {
      const match = /^channel\s*=\s*["']([^"']+)["']/.exec(line)
      if (match) {
        return match[1]!
      }
    }
  }
  const bare = tomlText.trim()
  if (bare !== '' && !bare.includes('[') && !bare.includes('=')) {
    return bare.split(/\s+/)[0]
  }
  return undefined
}

function parseToolchainArray(
  tomlText: string,
  key: 'components' | 'targets',
): string[] {
  const match = new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(
    tomlText,
  )
  return match
    ? [...match[1]!.matchAll(/["']([^"']+)["']/g)].map(item => item[1]!)
    : []
}

/**
 * Build the complete rustup install command from rust-toolchain.toml. Keeping
 * components and targets in the pin means setup installs what format, lint,
 * and cross-build commands need instead of only installing rustc + Cargo.
 */
export function rustupToolchainInstallArgs(tomlText: string): string[] {
  const channel = parseRustToolchainPin(tomlText)
  if (!channel) {
    return []
  }
  const profile = /^profile\s*=\s*["']([^"']+)["']/m.exec(tomlText)?.[1]
  const args = ['toolchain', 'install', channel]
  if (profile) {
    args.push('--profile', profile)
  }
  for (const component of parseToolchainArray(tomlText, 'components')) {
    args.push('--component', component)
  }
  for (const target of parseToolchainArray(tomlText, 'targets')) {
    args.push('--target', target)
  }
  return args
}

/**
 * Resolve the nearest toolchain pin for a Cargo manifest, stopping at the repo
 * root. A mixed-language monorepo may carry a root default plus a more specific
 * pin inside one Rust workspace.
 */
export function findRustToolchainFile(
  manifest: string,
  repoRoot: string,
): string | undefined {
  // File scanners return portable `/`-separated paths. Resolve both inputs
  // through the host path implementation before walking so Windows does not
  // compare `C:/repo` with `C:\\repo` and incorrectly miss the root pin.
  let dir = path.dirname(path.resolve(manifest))
  const root = path.resolve(repoRoot)
  while (dir === root || dir.startsWith(`${root}${path.sep}`)) {
    const candidate = path.join(dir, 'rust-toolchain.toml')
    if (existsSync(candidate)) {
      return candidate
    }
    if (dir === root) {
      break
    }
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * The skip reason for `setup:rust`, or undefined when the step should run. Pure
 * over the manifest count so the decision is unit-testable without a
 * filesystem.
 */
export function rustSkipReason(config: {
  readonly manifestCount: number
}): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  return cfg.manifestCount > 0
    ? undefined
    : 'no first-party Cargo.toml (repo has no Rust crates)'
}

/**
 * Ensure the pinned Rust toolchain is installed and every first-party crate's
 * dependencies are fetched from the committed `Cargo.lock`.
 */
export async function setupRust(
  options?: EcosystemStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const { commandExists, logger, repoRoot, runCommand } =
    resolveEcosystemOptions(options)
  const manifests = findOwnCargoManifests(repoRoot)
  const skip = rustSkipReason({ manifestCount: manifests.length })
  if (skip) {
    return skipResult(logger, 'setup:rust', skip)
  }
  if (!(await commandExists('rustup'))) {
    logger.fail(
      'setup:rust: rustup is not installed.\n' +
        '  Where: this dev machine (a first-party Cargo.toml is present).\n' +
        '  Saw: no rustup on PATH; wanted the Rust toolchain manager.\n' +
        '  Fix: install rustup from https://rustup.rs, then re-run pnpm run setup:rust.',
    )
    return { ok: false, reason: 'rustup not installed', skipped: false }
  }
  const pinFiles = new Set<string>()
  for (const manifest of manifests) {
    const pinFile = findRustToolchainFile(manifest, repoRoot)
    if (!pinFile) {
      logger.fail(
        `setup:rust: no rust-toolchain.toml covers ${manifest}.\n` +
          '  Where: the Cargo workspace or one of its parent directories up to the repo root.\n' +
          '  Saw: no exact toolchain pin; wanted reproducible local + CI compiler selection.\n' +
          '  Fix: add rust-toolchain.toml at the workspace or repo root, then re-run.',
      )
      return { ok: false, reason: 'toolchain pin missing', skipped: false }
    }
    pinFiles.add(pinFile)
  }
  for (const pinFile of pinFiles) {
    const tomlText = readFileSync(pinFile, 'utf8')
    const installArgs = rustupToolchainInstallArgs(tomlText)
    const channel = parseRustToolchainPin(tomlText)
    if (!channel || installArgs.length === 0) {
      logger.fail(
        `setup:rust: ${pinFile} has no toolchain channel.\n` +
          '  Fix: declare [toolchain] channel = "<exact-version>".',
      )
      return { ok: false, reason: 'toolchain channel missing', skipped: false }
    }
    logger.log(`setup:rust — ensuring toolchain ${channel}`)
    // rustup toolchain install is idempotent — it no-ops when the complete pin
    // is already present, including declared components and targets.
    const installed = await runCommand('rustup', installArgs)
    if (installed.exitCode !== 0) {
      logger.fail(
        `setup:rust: rustup could not install toolchain ${channel}.\n` +
          `  Where: rustup ${installArgs.join(' ')}.\n` +
          `  Saw: exit ${installed.exitCode}; wanted the pinned toolchain present.\n` +
          '  Fix: check network + the rust-toolchain.toml channel, then re-run.',
      )
      return {
        ok: false,
        reason: `toolchain ${channel} install failed`,
        skipped: false,
      }
    }
  }
  for (const manifest of manifests) {
    const dir = path.dirname(manifest)
    logger.log(
      `setup:rust — cargo fetch --locked (${path.relative(repoRoot, dir) || '.'})`,
    )
    const fetched = await runCommand('cargo', ['fetch', '--locked'], {
      cwd: dir,
    })
    if (fetched.exitCode !== 0) {
      logger.fail(
        `setup:rust: cargo fetch --locked failed in ${dir}.\n` +
          `  Where: cargo fetch --locked (cwd ${dir}).\n` +
          `  Saw: exit ${fetched.exitCode}; wanted every crate resolved from the committed Cargo.lock.\n` +
          '  Fix: run pnpm run update (or cargo generate-lockfile) to refresh the lock, then re-run.',
      )
      return { ok: false, reason: 'cargo fetch failed', skipped: false }
    }
  }
  logger.log(`setup:rust — fetched crates for ${manifests.length} manifest(s).`)
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupRust().then(
    result => {
      if (!result.ok) {
        process.exitCode = 1
      }
    },
    (e: unknown) => {
      mainLogger.error(e)
      process.exitCode = 1
    },
  )
}
