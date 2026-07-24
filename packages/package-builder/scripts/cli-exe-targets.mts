/**
 * @file Canonical naming for the `@socketsecurity/cli.exe.<triplet>` tail
 *   packages — the standalone-executable distribution family that replaces the
 *   decommissioned `@socketbin/cli-*` scope. Names follow the fleet dot-naming
 *   grammar `@<owner>/<name>[.<lang>].<target>[-<platform>]` with the `.exe`
 *   target and pnpm pack-app platform tails — glibc unsuffixed, `-musl` the
 *   only libc qualifier, `win32` spelled out. The gate is
 *   scripts/fleet/check/platform-tails-match-naming-domain.mts; the triplet
 *   set mirrors scripts/fleet/util/pack-app-triplets.mts, kept local so
 *   package-builder stays importable without reaching into fleet-owned code.
 *   Doctrine: docs/agents.md/fleet/binary-vs-napi-naming.md.
 */

/**
 * Npm scope the cli.exe tails publish under.
 */
export const CLI_EXE_SCOPE = '@socketsecurity'

/**
 * Every platform triplet the Socket CLI ships standalone executables for, in
 * ASCII order. Exactly the pnpm pack-app triplet set.
 */
export const CLI_EXE_TRIPLETS = [
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
 * Literal-union type derived from `CLI_EXE_TRIPLETS`.
 */
export type CliExeTriplet = (typeof CLI_EXE_TRIPLETS)[number]

const CLI_EXE_TRIPLET_SET: ReadonlySet<string> = new Set(CLI_EXE_TRIPLETS)

/**
 * Human description per triplet, stamped into generated manifests + READMEs.
 */
const TRIPLET_DESCRIPTIONS: Record<CliExeTriplet, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'macOS ARM64, Apple Silicon',
  'darwin-x64': 'macOS x64, Intel',
  'linux-arm64': 'Linux ARM64, glibc',
  'linux-arm64-musl': 'Linux ARM64, musl',
  'linux-x64': 'Linux x64, glibc',
  'linux-x64-musl': 'Linux x64, musl',
  'win32-arm64': 'Windows ARM64',
  'win32-x64': 'Windows x64',
} as Record<CliExeTriplet, string>

/**
 * The frozen `@socketbin/cli-*` fallback names that actually contain binaries
 * on npm — last published 2025-11-03, no new publish can ever happen. The
 * legacy scheme used `alpine` for musl and `win32` for Windows; the
 * `cli-win-*` and `cli-linux-*-musl` names that also exist on npm are empty
 * 0.0.0 placeholders and must never be targeted.
 */
const LEGACY_SOCKETBIN_UNSCOPED: Record<CliExeTriplet, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'cli-darwin-arm64',
  'darwin-x64': 'cli-darwin-x64',
  'linux-arm64': 'cli-linux-arm64',
  'linux-arm64-musl': 'cli-alpine-arm64',
  'linux-x64': 'cli-linux-x64',
  'linux-x64-musl': 'cli-alpine-x64',
  'win32-arm64': 'cli-win32-arm64',
  'win32-x64': 'cli-win32-x64',
} as Record<CliExeTriplet, string>

/**
 * Exact version of the frozen `@socketbin/cli-*` binaries on npm. The wrapper
 * package pins the legacy optionalDependencies to this — the scope is dead, so
 * the pin can never move.
 */
export const LEGACY_SOCKETBIN_VERSION = '0.0.0-20251103.61247'

/**
 * Version placeholder stamped into generated tail manifests. Replaced by
 * prepublish-cli-exe.mts before a staged publish; the `private` field is
 * stripped at the same time.
 */
export const CLI_EXE_VERSION_PLACEHOLDER = '0.0.0-replaced-by-prepublish'

/**
 * Package.json engine-restriction fields for a triplet.
 */
export interface CliExeEngineFields {
  readonly os: readonly [string]
  readonly cpu: readonly [string]
  readonly libc?: readonly ['glibc' | 'musl'] | undefined
}

/**
 * Type-guard: is `value` one of the shipped triplets?
 */
export function isCliExeTriplet(value: unknown): value is CliExeTriplet {
  return typeof value === 'string' && CLI_EXE_TRIPLET_SET.has(value)
}

/**
 * Compose a triplet from Node-style platform + arch + optional libc. Returns
 * undefined for unsupported combinations. `win32` stays `win32` — the legacy
 * `win` normalization does not apply to pack-app naming.
 */
export function tripletFromParts(
  platform: string,
  arch: string,
  libc?: string | undefined,
): CliExeTriplet | undefined {
  const muslSuffix = platform === 'linux' && libc === 'musl' ? '-musl' : ''
  const candidate = `${platform}-${arch}${muslSuffix}`
  return isCliExeTriplet(candidate) ? candidate : undefined
}

/**
 * Unscoped npm name for a triplet's tail, e.g. `cli.exe.darwin-arm64`. Also
 * the tarball basename on the registry and the generated directory name.
 */
export function cliExeUnscopedName(triplet: CliExeTriplet): string {
  return `cli.exe.${triplet}`
}

/**
 * Scoped npm name for a triplet's tail, e.g.
 * `@socketsecurity/cli.exe.darwin-arm64`.
 */
export function cliExePackageName(triplet: CliExeTriplet): string {
  return `${CLI_EXE_SCOPE}/${cliExeUnscopedName(triplet)}`
}

/**
 * Binary file name inside the tail's `bin/` directory.
 */
export function cliExeBinaryName(triplet: CliExeTriplet): string {
  return triplet.startsWith('win32-') ? 'socket.exe' : 'socket'
}

/**
 * Human description for a triplet.
 */
export function cliExeDescription(triplet: CliExeTriplet): string {
  return TRIPLET_DESCRIPTIONS[triplet]
}

/**
 * The `os` / `cpu` / optional `libc` manifest fields for a triplet, matching
 * `tripletEngineFields` in scripts/fleet/util/pack-app-triplets.mts so a tail
 * can never resolve on the wrong platform.
 */
export function cliExeEngineFields(triplet: CliExeTriplet): CliExeEngineFields {
  const parts = triplet.split('-')
  const os = parts[0]!
  const cpu = parts[1]!
  if (os !== 'linux') {
    return { cpu: [cpu], os: [os] }
  }
  return {
    cpu: [cpu],
    libc: [parts[2] === 'musl' ? 'musl' : 'glibc'],
    os: [os],
  }
}

/**
 * The frozen `@socketbin/*` fallback package name for a triplet, e.g.
 * `@socketbin/cli-alpine-x64` for `linux-x64-musl`. Kept as the compat chain's
 * second hop until the cli.exe tails are live and pinned; only names that
 * actually contain binaries are mapped.
 */
export function legacySocketbinPackageName(triplet: CliExeTriplet): string {
  return `@socketbin/${LEGACY_SOCKETBIN_UNSCOPED[triplet]}`
}

/**
 * Full package.json manifest for a triplet's tail. Built programmatically —
 * the conditional `libc` field makes a Handlebars JSON template messier than
 * constructing the object. Passes checkManifest in
 * scripts/fleet/check/platform-tails-match-naming-domain.mts: dotted `.exe`
 * target, pack-app tail, bin payload, exact engine fields.
 */
export function cliExeManifest(
  triplet: CliExeTriplet,
): Record<string, unknown> {
  const binaryName = cliExeBinaryName(triplet)
  const engine = cliExeEngineFields(triplet)
  return {
    name: cliExePackageName(triplet),
    version: CLI_EXE_VERSION_PLACEHOLDER,
    description: `Socket CLI standalone executable for ${cliExeDescription(triplet)}`,
    private: true,
    license: 'MIT',
    bin: {
      socket: `bin/${binaryName}`,
    },
    files: [`bin/${binaryName}`],
    os: engine.os,
    cpu: engine.cpu,
    ...(engine.libc ? { libc: engine.libc } : {}),
    repository: {
      type: 'git',
      url: 'git+https://github.com/SocketDev/socket-cli.git',
    },
    publishConfig: {
      access: 'public',
    },
  }
}
