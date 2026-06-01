/**
 * @file Canonical platform-triplet identifiers, matching pnpm pack-app's
 *   supported targets. Single source of truth for fleet surfaces that enumerate
 *   platforms: tail-package manifest generators, meta-package runtime loaders
 *   (resolve current process → triplet →
 *   `require.resolve('@<scope>/<prefix>-<triplet>/bin/<name>')`),
 *   source-allowlist entries, and lint rules that validate tail-name suffixes
 *   against the known set. Sorted ASCII byte order so the list reads
 *   identically to `socket/sort-named-imports` / `sort-source-methods`
 *   enforcement elsewhere — every consumer that wants priority order sorts
 *   downstream.
 *
 * @see https://pnpm.io/11.x/cli/pack-app for the upstream triplet spec.
 */

/**
 * Every platform triplet pnpm pack-app supports, in ASCII order.
 *
 * Linux gets four variants (glibc + musl × arm64 + x64). macOS and Windows get
 * two each (arm64 + x64). The `-musl` qualifier is Linux-only.
 */
export const PACK_APP_TRIPLETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-arm64-musl',
  'linux-x64',
  'linux-x64-musl',
  'win32-arm64',
  'win32-x64',
] as const

/**
 * Literal-union type derived from `PACK_APP_TRIPLETS`. Use as a type annotation
 * everywhere a triplet appears so a typo at the call site fails compile.
 */
export type PackAppTriplet = (typeof PACK_APP_TRIPLETS)[number]

/**
 * Linux-only subset (glibc + musl × arm64 + x64). For package families that
 * ship Linux binaries without macOS / Windows support.
 */
export const PACK_APP_TRIPLETS_LINUX = [
  'linux-arm64',
  'linux-arm64-musl',
  'linux-x64',
  'linux-x64-musl',
] as const satisfies readonly PackAppTriplet[]

/**
 * MacOS-only subset (arm64 + x64).
 */
export const PACK_APP_TRIPLETS_DARWIN = [
  'darwin-arm64',
  'darwin-x64',
] as const satisfies readonly PackAppTriplet[]

/**
 * Windows-only subset (arm64 + x64).
 */
export const PACK_APP_TRIPLETS_WIN32 = [
  'win32-arm64',
  'win32-x64',
] as const satisfies readonly PackAppTriplet[]

/**
 * Glibc-only subset (excludes musl). For families whose Linux build doesn't
 * support musl distros (Alpine, …).
 */
export const PACK_APP_TRIPLETS_GLIBC = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
] as const satisfies readonly PackAppTriplet[]

/**
 * O(1) membership set for hot paths (lint rules, allowlist validators).
 * Materialized once at module load.
 */
export const PACK_APP_TRIPLET_SET: ReadonlySet<PackAppTriplet> = new Set(
  PACK_APP_TRIPLETS,
)

/**
 * Type-guard: is `value` one of the canonical triplets?
 *
 * Use at trust boundaries — anywhere an untrusted string (CLI arg, env var,
 * release-tag-parsing output) is about to be used as a triplet.
 */
export function isPackAppTriplet(value: unknown): value is PackAppTriplet {
  return (
    typeof value === 'string' &&
    PACK_APP_TRIPLET_SET.has(value as PackAppTriplet)
  )
}

/**
 * Inputs to `resolveCurrentTriplet`. Pure data so the function is unit-testable
 * without mocking `process` or filesystem libc detection.
 */
export interface CurrentTripletInputs {
  /**
   * `process.platform` value.
   */
  readonly platform: NodeJS.Platform
  /**
   * `process.arch` value.
   */
  readonly arch: string
  /**
   * Whether the current Linux runtime uses musl libc. Ignored on non-Linux.
   * Detection is the caller's job (typically by probing
   * `/proc/self/map_files/../maps` or `ldd --version`).
   */
  readonly isMusl: boolean
}

/**
 * Pure-function triplet resolver. Returns the canonical triplet for the given
 * runtime inputs, or `undefined` if no triplet matches (running on an
 * unsupported platform or arch).
 *
 * Examples: - `{ platform: 'darwin', arch: 'arm64', isMusl: false }` →
 * `darwin-arm64` - `{ platform: 'linux', arch: 'x64', isMusl: true }` →
 * `linux-x64-musl` - `{ platform: 'sunos', arch: 'sparc', isMusl: false }` →
 * `undefined`
 */
export function resolveCurrentTriplet(
  inputs: CurrentTripletInputs,
): PackAppTriplet | undefined {
  const { platform, arch, isMusl } = inputs

  // Only Linux carries the libc qualifier.
  if (platform === 'linux') {
    if (arch === 'arm64') {
      return isMusl ? 'linux-arm64-musl' : 'linux-arm64'
    }
    if (arch === 'x64') {
      return isMusl ? 'linux-x64-musl' : 'linux-x64'
    }
    return undefined
  }

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return 'darwin-arm64'
    }
    if (arch === 'x64') {
      return 'darwin-x64'
    }
    return undefined
  }

  if (platform === 'win32') {
    if (arch === 'arm64') {
      return 'win32-arm64'
    }
    if (arch === 'x64') {
      return 'win32-x64'
    }
    return undefined
  }

  return undefined
}

/**
 * Parse a triplet suffix off the end of a tail-package name. Returns the
 * triplet if the name ends in one, `undefined` otherwise.
 *
 * Greedy-match against the canonical set so `linux-arm64-musl` wins over
 * `linux-arm64` when both could match — the longer triplet always sorts before
 * the shorter prefix in the constant list, so the first match wins.
 *
 * Examples: - `parseTripletSegment('acorn-linux-arm64-musl')` →
 * `linux-arm64-musl` - `parseTripletSegment('stuie-yoga-darwin-arm64')` →
 * `darwin-arm64` - `parseTripletSegment('acorn-wasm')` → `undefined`
 */
export function parseTripletSegment(name: string): PackAppTriplet | undefined {
  // Iterate longest-suffix-first so musl forms win over their glibc
  // shortenings.
  const ordered = PACK_APP_TRIPLETS.toSorted((a, b) => b.length - a.length)
  for (let i = 0, { length } = ordered; i < length; i += 1) {
    const triplet = ordered[i]!
    if (name === triplet || name.endsWith(`-${triplet}`)) {
      return triplet
    }
  }
  return undefined
}

/**
 * The `os` / `cpu` / `libc` package.json fields for a given triplet. Tail
 * manifest generators stamp these directly so a tail can never resolve on the
 * wrong platform.
 */
export interface TripletEngineFields {
  readonly os: readonly [NodeJS.Platform]
  readonly cpu: readonly [string]
  readonly libc?: readonly ['glibc' | 'musl'] | undefined
}

/**
 * Resolve the package.json engine-restriction fields (`os`, `cpu`, optionally
 * `libc`) for a triplet. Used by tail-manifest generators.
 */
export function tripletEngineFields(
  triplet: PackAppTriplet,
): TripletEngineFields {
  if (triplet === 'darwin-arm64') {
    return { os: ['darwin'], cpu: ['arm64'] }
  }
  if (triplet === 'darwin-x64') {
    return { os: ['darwin'], cpu: ['x64'] }
  }
  if (triplet === 'linux-arm64') {
    return { os: ['linux'], cpu: ['arm64'], libc: ['glibc'] }
  }
  if (triplet === 'linux-arm64-musl') {
    return { os: ['linux'], cpu: ['arm64'], libc: ['musl'] }
  }
  if (triplet === 'linux-x64') {
    return { os: ['linux'], cpu: ['x64'], libc: ['glibc'] }
  }
  if (triplet === 'linux-x64-musl') {
    return { os: ['linux'], cpu: ['x64'], libc: ['musl'] }
  }
  if (triplet === 'win32-arm64') {
    return { os: ['win32'], cpu: ['arm64'] }
  }
  return { os: ['win32'], cpu: ['x64'] }
}
