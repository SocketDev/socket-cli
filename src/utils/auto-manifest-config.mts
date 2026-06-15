import semver from 'semver'

import type { SocketJson } from './socket-json.mts'

// Coana gained the `--auto-manifest-config` option in this version. Older Coana
// builds reject the unknown flag and abort the run, so callers must not forward
// the config to a Coana older than this.
export const AUTO_MANIFEST_CONFIG_MIN_COANA_VERSION = '15.4.1'

// Per-ecosystem build-tool options handed off to the Coana CLI — used both when
// generating manifests (`coana manifest <ecosystem>`) and, in socket mode, for
// reach-time dependency resolution (`coana run`). This mirrors the Coana-side
// `--auto-manifest-config` shape: socket-cli owns mapping `socket.json` onto it,
// so Coana stays uncoupled from `socket.json`'s schema. Keeping the
// per-ecosystem options namespaced (rather than as flat CLI flags) avoids the
// ambiguity of a bare `--bin`/`--include-configs` when a repo has more than one
// build tool.
export type BuildToolOptions = {
  // Build-tool executable override (e.g. `./gradlew`, `atlas-mvn`).
  bin?: string | undefined
  // Comma-separated config-name globs to skip.
  excludeConfigs?: string | undefined
  // `socket.json`'s per-ecosystem `ignoreUnresolved` (warn vs fail on unresolved
  // dependencies), forwarded verbatim. NOTE: this is NOT the reach-time
  // fail-closed switch — that's the run-wide `failOnBuildToolError` below.
  ignoreUnresolved?: boolean | undefined
  // Comma-separated config-name globs to resolve.
  includeConfigs?: string | undefined
  // Extra build-tool options, pre-split into argv. Coana maps these straight to
  // the tool's opts (no splitting on its side). Mapped from `socket.json`'s
  // `gradleOpts`/`sbtOpts` string.
  opts?: string[] | undefined
}

// The Coana hand-off config. `failOnBuildToolError` is run-wide (top level)
// because `--auto-manifest` is a single CLI mode, not a per-package-manager
// setting. The per-ecosystem entries are present only for ecosystems configured
// (and not disabled) in `socket.json`; absent ecosystems fall to Coana's own
// defaults.
export type AutoManifestConfig = {
  // Run-wide fail-closed switch. When true, Coana treats a build-tool step
  // failure as fatal rather than tolerating it. socket-cli sets it true under
  // `--auto-manifest`; left unset on plain `--reach` (permissive — Coana's
  // default best-effort behaviour).
  failOnBuildToolError?: boolean | undefined
  gradle?: BuildToolOptions | undefined
  sbt?: BuildToolOptions | undefined
}

// Splits a `socket.json` opts string (`gradleOpts`/`sbtOpts`) into argv, matching
// how the standalone `socket manifest` path splits it. Returns undefined when
// there's nothing to pass so the field is omitted from the config.
function parseOpts(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }
  const parts = value
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)
  return parts.length ? parts : undefined
}

// Maps `socket.json`'s `defaults.manifest.<ecosystem>` build-tool options onto
// the Coana hand-off config.
//
// `autoManifest` reflects whether the run is `--auto-manifest` (fail-closed:
// `failOnBuildToolError=true`) vs plain `--reach` (permissive:
// `failOnBuildToolError` left unset so Coana's default applies). Per-ecosystem
// options are forwarded verbatim from `socket.json`; disabled ecosystems are
// omitted so they fall back to Coana's defaults.
export function buildAutoManifestConfig(
  sockJson: SocketJson,
  { autoManifest }: { autoManifest: boolean },
): AutoManifestConfig {
  const manifest = sockJson.defaults?.manifest
  const config: AutoManifestConfig = {}

  // `--auto-manifest` expects every build-tool command to succeed, so a
  // build-tool step failure should be fatal rather than tolerated.
  if (autoManifest) {
    config.failOnBuildToolError = true
  }

  const gradle = manifest?.gradle
  if (gradle && !gradle.disabled) {
    config.gradle = {
      bin: gradle.bin,
      excludeConfigs: gradle.excludeConfigs,
      ignoreUnresolved: gradle.ignoreUnresolved,
      includeConfigs: gradle.includeConfigs,
      opts: parseOpts(gradle.gradleOpts),
    }
  }

  const sbt = manifest?.sbt
  if (sbt && !sbt.disabled) {
    config.sbt = {
      bin: sbt.bin,
      excludeConfigs: sbt.excludeConfigs,
      ignoreUnresolved: sbt.ignoreUnresolved,
      includeConfigs: sbt.includeConfigs,
      opts: parseOpts(sbt.sbtOpts),
    }
  }

  return config
}

// Whether a resolved Coana version understands `--auto-manifest-config`. An
// unparseable version (e.g. a git ref or custom build tag) is treated as
// supported so explicit overrides aren't second-guessed; callers gate local
// Coana builds (which have no resolvable version) separately.
export function coanaSupportsAutoManifestConfig(
  version: string | undefined,
): boolean {
  const coerced = version ? semver.coerce(version) : undefined
  return coerced
    ? semver.gte(coerced, AUTO_MANIFEST_CONFIG_MIN_COANA_VERSION)
    : true
}

// True when there's nothing to hand to Coana: no per-ecosystem options and the
// run mode is left at Coana's permissive default. When true, the
// `--auto-manifest-config` option should be omitted entirely.
export function isAutoManifestConfigEmpty(config: AutoManifestConfig): boolean {
  return (
    !config.gradle && !config.sbt && config.failOnBuildToolError === undefined
  )
}
