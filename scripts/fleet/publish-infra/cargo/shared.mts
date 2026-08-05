/**
 * @file Cargo (crates.io) metadata resolution for the cargo-publish flow: read
 *   the publishable package's name/version/repository/manifest from
 *   `cargo metadata`, resolve the packaged `.crate` artifact path, and hash the
 *   packaged bytes. The cargo analog of npm/shared.mts's package.json reader;
 *   the registry-agnostic spawn/git/JSON helpers live in ../shared.mts.
 */

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { logApproveHandoff, rootPath, runCapture } from '../shared.mts'

// The approve leg an operator runs after a cargo staging run. `cargo:publish`
// is the channel-enforced script for every crates-registry member.
// NO `--` before the flag. pnpm forwards a bare `--` through to the script, and
// cargo-publish parses with `parseArgs`, which files everything after `--` under
// the `'--'` key instead of parsing it: `--approve` lands in
// `values['--']` and `values.approve` stays undefined.
//
// This one fails SILENTLY, unlike its npm twin. cargo-publish does not go
// through `runMain`, so nothing refuses the bare `--` — the run simply proceeds
// down the default staging path while the operator believes they approved.
export const CARGO_APPROVE_COMMAND = 'pnpm run cargo:publish --approve'

// Who owns the promotion, stated once so nobody reads cargo/approve.mts to find
// out. It runs `cargo publish --locked` itself, then cuts the tag + release.
export const CARGO_APPROVE_OWNERSHIP =
  'That command performs the crates.io publish itself: it runs `cargo publish ' +
  '--locked` from your machine, then creates the git tag and GitHub release ' +
  'once the version resolves as live. Publishing is PERMANENT — a version can ' +
  'only be yanked, never overwritten.'

/**
 * Print the staged-to-approve handoff for crates.io. Called ONCE at the end of
 * a staging run so the actionable command is the last thing on screen.
 */
export function logCargoApproveHandoff(): void {
  logApproveHandoff(CARGO_APPROVE_COMMAND, CARGO_APPROVE_OWNERSHIP)
}

export interface CargoPackage {
  name: string
  version: string
  repository?: string | undefined
  manifestPath: string
}

// A raw `cargo metadata` package entry, projected to the fields we read.
interface RawCargoPackage {
  manifest_path?: unknown | undefined
  name?: unknown | undefined
  publish?: unknown | undefined
  repository?: unknown | undefined
  version?: unknown | undefined
}

/**
 * Whether a `cargo metadata` `publish` value means the package may be
 * published. cargo emits `null` for the Cargo.toml default (publishable
 * anywhere), `[]` for `publish = false`, never publish, and a non-empty array
 * (e.g. `["crates-io"]`) for an allowlist, still publishable. Only an explicit
 * empty array opts out — so we treat null/undefined and any non-empty allowlist
 * as publishable.
 */
export function isPublishable(publish: unknown): boolean {
  if (publish === null || publish === undefined) {
    return true
  }
  return Array.isArray(publish) && publish.length > 0
}

/**
 * Every publishable package in the workspace at `cwd`, projected to
 * `CargoPackage`, from `cargo metadata --format-version 1 --no-deps`. Defaults
 * to this checkout; a caller configuring another repo (the trusted-publisher
 * CLI's `--path <dir>`) passes that repo's root so crate discovery reads the
 * workspace it is actually targeting. Returns `[]` when nothing is publishable
 * (every package sets `publish = false`). Throws LOUD when `cargo metadata`
 * fails, its JSON can't be parsed, or a publishable package is missing a field.
 * The version-discipline checks iterate every entry (a workspace can publish
 * several crates); the publish path (`readCargoPackage`) selects one.
 */
export async function readPublishableCargoPackages(
  cwd: string = rootPath,
): Promise<CargoPackage[]> {
  const { code, stdout } = await runCapture(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps'],
    cwd,
  )
  if (code !== 0) {
    throw new Error(
      `[cargo] \`cargo metadata\` exited ${code} — is this a cargo workspace?`,
    )
  }
  let parsed: { packages?: RawCargoPackage[] | undefined }
  try {
    parsed = JSON.parse(stdout) as { packages?: RawCargoPackage[] | undefined }
  } catch {
    throw new Error('[cargo] could not parse `cargo metadata` JSON output.')
  }
  const packages = Array.isArray(parsed.packages) ? parsed.packages : []
  const out: CargoPackage[] = []
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const p = packages[i]!
    if (!isPublishable(p.publish)) {
      continue
    }
    const name = typeof p.name === 'string' ? p.name : undefined
    const version = typeof p.version === 'string' ? p.version : undefined
    const manifestPath =
      typeof p.manifest_path === 'string' ? p.manifest_path : undefined
    if (!name || !version || !manifestPath) {
      throw new Error(
        '[cargo] a publishable package is missing name/version/manifest_path ' +
          'in `cargo metadata` output.',
      )
    }
    out.push({
      manifestPath,
      name,
      version,
      ...(typeof p.repository === 'string' && p.repository
        ? { repository: p.repository }
        : {}),
    })
  }
  return out
}

/**
 * Resolve the single publishable package. Fails LOUD when nothing is
 * publishable (every package sets `publish = false`) or when more than one is
 * (ambiguous — pass `packageName`, wired to the `--package` selector, to
 * disambiguate). Returns the package's name/version/repository/manifest_path.
 */
export async function readCargoPackage(
  packageName?: string | undefined,
): Promise<CargoPackage> {
  const publishable = await readPublishableCargoPackages()
  if (publishable.length === 0) {
    throw new Error(
      '[cargo] no publishable package found (every package sets ' +
        '`publish = false`). Nothing to publish.',
    )
  }
  const names = publishable.map(p => p.name).join(', ')
  if (packageName) {
    const match = publishable.find(p => p.name === packageName)
    if (!match) {
      throw new Error(
        `[cargo] --package ${packageName} is not a publishable package. ` +
          `Publishable: ${names}.`,
      )
    }
    return match
  }
  if (publishable.length > 1) {
    throw new Error(
      `[cargo] ${publishable.length} publishable packages (${names}); ` +
        'ambiguous. Pass --package <name> to select one.',
    )
  }
  return publishable[0]!
}

/**
 * The packaged artifact path `cargo package` writes:
 * `<root>/target/package/<name>-<version>.crate`.
 */
export function cratePath(name: string, version: string): string {
  return path.join(rootPath, 'target', 'package', `${name}-${version}.crate`)
}

/**
 * Sha256 hex of the `.crate` bytes at `filePath` (node:crypto). The staged
 * digest the `--approve` integrity gate compares against.
 */
export function crateSha256(filePath: string): string {
  const bytes = readFileSync(filePath)
  return crypto.createHash('sha256').update(bytes).digest('hex')
}
