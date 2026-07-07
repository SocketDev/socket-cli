/*
 * @file Canonical ABI/NAPI target identifiers, matching napi-rs's naming rules
 *   (`platform-arch[-abi]` derived from the Rust target triple; darwin carries
 *   no ABI segment, linux carries an EXPLICIT `-gnu` or `-musl`, windows
 *   carries `-msvc`). Single source of truth for fleet surfaces that enumerate
 *   `.node` addon targets: tail-package manifest generators, meta-package
 *   runtime loaders, source-allowlist entries (`kind: 'napi'`), and the
 *   `platform-tails-match-naming-domain` check.
 *
 *   THE TWO NAMING DOMAINS ARE DISTINCT BY DESIGN (ratified 2026-07-04):
 *   - BINARIES (kind `cli`) follow pnpm pack-app naming —
 *     `pack-app-triplets.mts`, 8 targets, glibc unsuffixed, no toolchain
 *     segment (`linux-x64`, `win32-arm64`).
 *   - ABI/NAPI (kind `napi`) follows napi-rs naming — THIS file, 5 default
 *     targets, `-gnu`/`-msvc` explicit (`linux-x64-gnu`, `win32-x64-msvc`),
 *     the wasm fallback covers platforms outside the native set.
 *   Never blur the two: the suffix tells a reader which artifact kind a tail
 *   ships. See docs/agents.md/fleet/binary-vs-napi-naming.md.
 *
 * @see https://github.com/napi-rs/napi-rs — `parseTriple` derives
 *   `platformArchABI` exactly this way (oxc's `@oxc-parser/binding-*` packages
 *   are the reference deployment of the convention).
 */

/**
 * Every ABI/NAPI target the fleet ships or recognizes, in ASCII order.
 *
 * Linux always carries an explicit libc ABI (`-gnu` or `-musl`) — unlike the
 * pack-app binary domain where glibc is unsuffixed. Windows always carries
 * `-msvc`. Darwin never carries an ABI segment. `wasm32-wasi` is the universal
 * fallback binding target.
 */
export const NAPI_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-x64-gnu',
  'linux-x64-musl',
  'wasm32-wasi',
  'win32-arm64-msvc',
  'win32-x64-msvc',
] as const

/**
 * Literal-union type derived from `NAPI_TARGETS`. Use as a type annotation
 * everywhere a napi target appears so a typo at the call site fails compile.
 */
export type NapiTarget = (typeof NAPI_TARGETS)[number]

/**
 * Native (non-wasm) subset — the targets that produce a `.node` payload.
 */
export type NapiNativeTarget = Exclude<NapiTarget, 'wasm32-wasi'>

/**
 * The fleet-default build matrix for `.node` addons: 5 targets (napi-rs's
 * popular-target starter set). Everything else falls back to wasm at load
 * time, so musl and win32-arm64 are deliberately absent — an addon family
 * opts into extra targets explicitly, it doesn't inherit them.
 */
export const NAPI_TARGETS_DEFAULT = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-x64-gnu',
  'win32-x64-msvc',
] as const satisfies readonly NapiTarget[]

/**
 * O(1) membership set for hot paths (lint rules, allowlist validators).
 * Materialized once at module load.
 */
export const NAPI_TARGET_SET: ReadonlySet<NapiTarget> = new Set(NAPI_TARGETS)

/**
 * Rust target triple → napi target name, for the targets the fleet builds.
 * Mirrors napi-rs `parseTriple` output for these triples exactly.
 */
export const RUST_TRIPLE_TO_NAPI_TARGET: Readonly<Record<string, NapiTarget>> =
  {
    'aarch64-apple-darwin': 'darwin-arm64',
    'aarch64-pc-windows-msvc': 'win32-arm64-msvc',
    'aarch64-unknown-linux-gnu': 'linux-arm64-gnu',
    'aarch64-unknown-linux-musl': 'linux-arm64-musl',
    'wasm32-wasip1-threads': 'wasm32-wasi',
    'x86_64-apple-darwin': 'darwin-x64',
    'x86_64-pc-windows-msvc': 'win32-x64-msvc',
    'x86_64-unknown-linux-gnu': 'linux-x64-gnu',
    'x86_64-unknown-linux-musl': 'linux-x64-musl',
  }

/**
 * Type-guard: is `value` one of the canonical napi targets?
 *
 * Use at trust boundaries — anywhere an untrusted string (CLI arg, env var,
 * release-tag-parsing output) is about to be used as a napi target.
 */
export function isNapiTarget(value: unknown): value is NapiTarget {
  return typeof value === 'string' && NAPI_TARGET_SET.has(value as NapiTarget)
}

/**
 * Inputs to `resolveCurrentNapiTarget`. Pure data so the function is
 * unit-testable without mocking `process` or filesystem libc detection.
 */
export interface CurrentNapiTargetInputs {
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
   */
  readonly isMusl: boolean
}

/**
 * Pure-function napi-target resolver for runtime loader require-chains.
 * Returns the native target for the given runtime inputs, or `undefined` when
 * no native target matches (the caller then falls back to the wasm binding).
 *
 * Examples: - `{ platform: 'linux', arch: 'x64', isMusl: false }` →
 * `linux-x64-gnu` - `{ platform: 'linux', arch: 'x64', isMusl: true }` →
 * `linux-x64-musl` - `{ platform: 'freebsd', arch: 'x64', isMusl: false }` →
 * `undefined`
 */
export function resolveCurrentNapiTarget(
  inputs: CurrentNapiTargetInputs,
): NapiNativeTarget | undefined {
  const { arch, isMusl, platform } = inputs

  if (platform === 'linux') {
    if (arch === 'arm64') {
      return isMusl ? 'linux-arm64-musl' : 'linux-arm64-gnu'
    }
    if (arch === 'x64') {
      return isMusl ? 'linux-x64-musl' : 'linux-x64-gnu'
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
      return 'win32-arm64-msvc'
    }
    if (arch === 'x64') {
      return 'win32-x64-msvc'
    }
    return undefined
  }

  return undefined
}

/**
 * Parse a napi-target suffix off the end of a tail-package name. Returns the
 * target if the name ends in one, `undefined` otherwise.
 *
 * Longest-suffix-first so ABI-qualified forms win over any shorter overlap.
 *
 * Examples: - `parseNapiTargetSegment('acorn-linux-x64-gnu')` →
 * `linux-x64-gnu` - `parseNapiTargetSegment('acorn-darwin-arm64')` →
 * `darwin-arm64` - `parseNapiTargetSegment('acorn-linux-x64')` → `undefined`
 * (bare linux belongs to the pack-app BINARY domain, not this one)
 */
export function parseNapiTargetSegment(name: string): NapiTarget | undefined {
  // oxlint-disable-next-line unicorn/no-array-sort -- `NAPI_TARGETS` is a shared module-level const, so the spread copies it first; an in-place sort would mutate the constant list every caller shares. .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  const ordered = [...NAPI_TARGETS].sort((a, b) => b.length - a.length)
  for (let i = 0, { length } = ordered; i < length; i += 1) {
    const target = ordered[i]!
    if (name === target || name.endsWith(`-${target}`)) {
      return target
    }
  }
  return undefined
}

/**
 * The `os` / `cpu` / `libc` package.json fields for a native napi target. Tail
 * manifest generators stamp these directly so a tail can never resolve on the
 * wrong platform. (`wasm32-wasi` is excluded by type — the wasm binding is
 * platform-unrestricted.)
 */
export interface NapiTargetEngineFields {
  readonly os: readonly [NodeJS.Platform]
  readonly cpu: readonly [string]
  readonly libc?: readonly ['glibc' | 'musl'] | undefined
}

/**
 * Resolve the package.json engine-restriction fields (`os`, `cpu`, optionally
 * `libc`) for a native napi target. Used by tail-manifest generators.
 */
export function napiTargetEngineFields(
  target: NapiNativeTarget,
): NapiTargetEngineFields {
  if (target === 'darwin-arm64') {
    return { cpu: ['arm64'], os: ['darwin'] }
  }
  if (target === 'darwin-x64') {
    return { cpu: ['x64'], os: ['darwin'] }
  }
  if (target === 'linux-arm64-gnu') {
    return { cpu: ['arm64'], libc: ['glibc'], os: ['linux'] }
  }
  if (target === 'linux-arm64-musl') {
    return { cpu: ['arm64'], libc: ['musl'], os: ['linux'] }
  }
  if (target === 'linux-x64-gnu') {
    return { cpu: ['x64'], libc: ['glibc'], os: ['linux'] }
  }
  if (target === 'linux-x64-musl') {
    return { cpu: ['x64'], libc: ['musl'], os: ['linux'] }
  }
  if (target === 'win32-arm64-msvc') {
    return { cpu: ['arm64'], os: ['win32'] }
  }
  return { cpu: ['x64'], os: ['win32'] }
}
