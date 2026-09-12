/**
 * Shared types + walker prune defaults for the Bazel Maven extraction
 * pipeline. Split from the orchestrator so the CLI command, the per-workspace
 * processor, and the run-support helpers can share one vocabulary.
 */
import { IGNORED_DIRS } from '../../../util/fs/glob.mts'

export type ExtractBazelOptions = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
  cwd: string
  // Optional env override used for python-shim PATH augmentation.
  env?: NodeJS.ProcessEnv | undefined
  // Directory basenames the workspace walker must not descend into.
  // Caller-supplied so the orchestrator stays generic; the CLI command
  // composes the codebase-wide `IGNORED_DIRS` with Bazel-specific dirs
  // like `.socket-auto-manifest`.
  ignoreDirNames?: ReadonlySet<string> | undefined
  // Directory basename prefixes the workspace walker must not descend
  // into. Caller-supplied so the orchestrator stays generic; the CLI
  // command supplies `bazel-` for Bazel's output_base symlinks.
  ignoreDirPrefixes?: readonly string[] | undefined
  out: string
  // Use the auto-manifest sibling directory instead of writing directly to `out`.
  outLayout?: 'flat' | undefined
  // Per-repo cquery timeout in milliseconds. When the caller leaves this
  // unset the orchestrator falls back to its auto-manifest default, kept
  // short so the wider scan is not stalled. The explicit
  // `socket manifest bazel` command wires this to a CLI flag with a longer
  // default.
  perRepoTimeoutMs?: number | undefined
  verbose: boolean
}

// Best-effort-per-hub produces four distinct run outcomes a single `ok`
// boolean would conflate:
//  - `complete`    — every discovered hub extracted cleanly; >=1 manifest.
//  - `partial`     — >=1 manifest written, but at least one hub failed,
//                    timed out, or dropped edges. Worth uploading, but the
//                    graph is known-incomplete.
//  - `noEcosystem` — no Bazel/Maven found. Whether that's an error is
//                    caller-dependent (tolerated in auto mode, error in
//                    explicit mode), so it must NOT be flattened into the
//                    failure states.
//  - `hardFailure` — zero manifests written and it wasn't `noEcosystem`
//                    (discovery threw, or every discovered hub failed).
//                    Always an error for every caller.
export type ExtractBazelStatus =
  | 'complete'
  | 'hardFailure'
  | 'noEcosystem'
  | 'partial'

// Per-hub extraction state inside one workspace. Recorded so the CLI can emit
// a machine-readable completeness signal instead of presenting a partial
// extraction as complete.
//  - `populated`     — the hub yielded >=1 artifact and a manifest was written.
//  - `empty`         — the hub is defined but has no Maven targets.
//  - `not-defined`   — the probed conventional name does not exist here.
//  - `skipped-lockfile` — a committed maven_install.json already covers this
//                    hub, so the CLI deliberately did not re-emit it.
//  - `failed`        — the hub's cquery errored, timed out, or its graph was
//                    known-incomplete (dropped/pruned edges, --keep_going).
//  - `indeterminate` — discovery could not classify the hub (probe threw or
//                    returned an unrecognized error); NOT evidence of absence.
export type HubState =
  | 'populated'
  | 'empty'
  | 'not-defined'
  | 'skipped-lockfile'
  | 'failed'
  | 'indeterminate'

export type HubOutcome = {
  hub: string
  state: HubState
  // Short, machine-stable reason when the hub is `failed`/`indeterminate`.
  reason?: string | undefined
}

// Per-workspace outcome. `load` distinguishes a workspace we could not even
// read (`failed` — e.g. an unbound-var MODULE.bazel fragment) from one we
// analyzed (`loaded`). A workspace that failed to load contributes to a
// hard failure when nothing else was analyzable, and to a partial otherwise.
export type WorkspaceOutcome = {
  relPath: string
  load: 'loaded' | 'failed'
  hubs: HubOutcome[]
  // Set when the workspace itself could not be analyzed.
  reason?: string | undefined
}

export type ExtractBazelResult = {
  artifactCount: number
  manifestPaths: string[]
  status: ExtractBazelStatus
  // True only when `status === 'complete'`. Surfaced so downstream consumers
  // (and the CLI's emitted summary) get a single machine-readable
  // completeness flag without re-deriving it from `status`.
  complete: boolean
  // Per-workspace / per-hub analyzability breakdown backing the completeness
  // signal. Empty for `noEcosystem` and early `hardFailure` (toolchain setup
  // failed before any workspace was inspected).
  workspaceOutcomes: WorkspaceOutcome[]
}

// Default directory-prune policy for the Bazel workspace walk. The
// orchestrator applies this unconditionally so neither caller (the explicit
// `socket manifest bazel` command nor `--auto-manifest`) can omit it and let
// the walk descend `node_modules`/VCS/vendored trees. Callers may
// pass extra names/prefixes to EXTEND, not replace, this set.
export const DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES: ReadonlySet<string> =
  new Set([
    ...IGNORED_DIRS,
    '.hg',
    '.idea',
    '.pnpm-store',
    '.socket-auto-manifest',
    '.svn',
    '.vscode',
  ])
// Bazel's `bazel-*` output_base symlinks.
export const DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES: readonly string[] = [
  'bazel-',
]
