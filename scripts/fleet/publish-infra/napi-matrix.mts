/**
 * @file Canonical CI build matrix for napi `.node` addon families. A
 *   native-addon member declares WHICH napi targets it ships; this derives the
 *   per-platform GitHub Actions matrix — one build job per target on the right
 *   runner — so no member hardcodes a `targets.mts` of its own (the drift that
 *   silently broke stuie's publish when the file moved). The target list is the
 *   fleet-canonical `NAPI_TARGETS`; the runner per target is the fleet default
 *   here, overridable per repo. `buildNapiMatrix` is pure and unit-tested; the
 *   CLI (`--print-matrix`) emits the single-line JSON the workflow captures
 *   into `$GITHUB_OUTPUT`, and fails LOUD on an empty result so a misconfigured
 *   member can never fan its build out to nothing.
 */

import process from 'node:process'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { loadSocketWheelhouseConfig } from '../paths.mts'
import {
  isNapiTarget,
  NAPI_TARGETS,
  NAPI_TARGETS_DEFAULT,
} from '../util/napi-targets.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import type { NapiNativeTarget, NapiTarget } from '../util/napi-targets.mts'

// The fleet-default GitHub Actions runner for each native napi target. Every
// target builds NATIVELY — the runner's host triple matches the target, so a
// native `cargo build` produces the addon with no cross-toolchain. A member
// overrides a single entry via config when it needs a different image.
export const NAPI_TARGET_DEFAULT_RUNNER: Readonly<
  Record<NapiNativeTarget, string>
> = {
  'darwin-arm64': 'macos-14',
  'darwin-x64': 'macos-15-intel',
  'linux-arm64-gnu': 'ubuntu-24.04-arm',
  'linux-arm64-musl': 'ubuntu-24.04-arm',
  'linux-x64-gnu': 'ubuntu-latest',
  'linux-x64-musl': 'ubuntu-latest',
  'win32-arm64-msvc': 'windows-11-arm',
  'win32-x64-msvc': 'windows-latest',
}

// One row of the GitHub Actions build matrix: the canonical napi target and
// the runner that builds it. `platformId` is the loader-vocabulary id a
// member's build/staging keys on, derived from the target so a member need not
// restate it.
export interface NapiMatrixEntry {
  platformId: string
  runner: string
  target: NapiNativeTarget
}

// The full GitHub Actions matrix object — `{ include: [...] }` is the shape
// `strategy.matrix` consumes via `fromJSON`.
export interface NapiMatrix {
  include: NapiMatrixEntry[]
}

/**
 * Derive a member's loader `platformId` from a napi target: drop the explicit
 * libc/msvc ABI segment and shorten `win32` to `win`, matching the
 * `getPlatformIdentifier` vocabulary native-addon loaders use for their
 * per-platform require path (`darwin-arm64`, `linux-x64`, `win-x64`).
 */
export function napiPlatformId(target: NapiNativeTarget): string {
  // `-musl` is deliberately NOT stripped: it distinguishes the musl build from
  // the glibc one, which the loader has to tell apart. Only `-gnu`/`-msvc` go.
  return target.replace(/-(?:gnu|msvc)$/, '').replace(/^win32-/, 'win-')
}

/**
 * Build the canonical CI matrix for the given napi targets. Pure. `targets`
 * defaults to the fleet 5-target starter set; entries emit in canonical
 * `NAPI_TARGETS` order regardless of input order. `runnerOverrides` swaps the
 * default runner for named targets (e.g. a member pinning `darwin-x64` to a
 * specific intel-mac image). An unknown or `wasm32-wasi` target is ignored —
 * wasm is a load-time fallback, never a build-matrix leg.
 */
export function buildNapiMatrix(
  options?:
    | {
        runnerOverrides?:
          | Readonly<Partial<Record<NapiNativeTarget, string>>>
          | undefined
        targets?: readonly NapiTarget[] | undefined
      }
    | undefined,
): NapiMatrix {
  const { runnerOverrides = {}, targets = NAPI_TARGETS_DEFAULT } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const wanted = new Set(targets)
  const include: NapiMatrixEntry[] = []
  for (let i = 0, { length } = NAPI_TARGETS; i < length; i += 1) {
    const target = NAPI_TARGETS[i]!
    if (target === 'wasm32-wasi' || !wanted.has(target)) {
      continue
    }
    const native = target as NapiNativeTarget
    include.push({
      platformId: napiPlatformId(native),
      runner: runnerOverrides[native] ?? NAPI_TARGET_DEFAULT_RUNNER[native],
      target: native,
    })
  }
  return { include }
}

/**
 * Read a repo's declared napi targets + runner overrides from its
 * `.config/repo/socket-wheelhouse.json` `napi` block and build the canonical
 * matrix. Returns an empty matrix when the block is absent or declares no
 * recognized target — the CLI treats that as a hard error rather than emitting
 * an empty build. `readConfig` is injectable so tests drive it with no disk.
 */
export function resolveRepoNapiMatrix(
  options?:
    | {
        readConfig?:
          | (() => { napi?: unknown | undefined } | undefined)
          | undefined
      }
    | undefined,
): NapiMatrix {
  const { readConfig } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  const config = readConfig ? readConfig() : loadSocketWheelhouseConfig()?.value
  const napi = (config?.napi ?? {}) as {
    platforms?: unknown | undefined
    runners?: unknown | undefined
  }
  const targets = Array.isArray(napi.platforms)
    ? napi.platforms.filter(isNapiTarget)
    : []
  const runnerOverrides =
    napi.runners && typeof napi.runners === 'object'
      ? (napi.runners as Partial<Record<NapiNativeTarget, string>>)
      : {}
  return buildNapiMatrix({ runnerOverrides, targets })
}

// Emit the repo's canonical matrix as single-line, prefix-free JSON for
// `$GITHUB_OUTPUT`, or fail LOUD (exit 1) on an empty result. Stream access is
// kept inside the function so nothing touches stdout/stderr at module eval.
function printMatrixCli(): void {
  const matrix = resolveRepoNapiMatrix()
  if (matrix.include.length === 0) {
    process.stderr.write(
      'napi-matrix: no recognized napi.platforms in ' +
        '.config/repo/socket-wheelhouse.json; refusing to emit an empty build ' +
        'matrix (declare a `napi.platforms` array of fleet NAPI_TARGETS).\n',
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(JSON.stringify(matrix))
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'derives the canonical GitHub Actions build matrix for a repo napi addon target set',
  help: `Usage: node scripts/fleet/publish-infra/napi-matrix.mts [flags]

  --print-matrix  emit the repo matrix as single-line JSON for $GITHUB_OUTPUT`,
}

if (isMainModule(import.meta.url)) {
  runMain(() => {
    // Without `--print-matrix` the CLI stays a no-op: the module is imported
    // for its pure helpers, and only the workflow's explicit flag emits JSON.
    if (process.argv.includes('--print-matrix')) {
      printMatrixCli()
    }
  }, SCRIPT_META)
}
