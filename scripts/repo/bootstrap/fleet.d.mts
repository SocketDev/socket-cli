//#region scripts/repo/gen/bootstrap/src/helpers.d.mts
type FleetCommentStyle = 'hash' | 'html' | 'slash';
interface BundleManifest {
  readonly files: Record<string, string>;
  readonly generatedPaths?: readonly string[] | undefined;
  readonly movedPaths?: ReadonlyArray<{
    from: string;
    to: string;
  }> | undefined;
  readonly removedPaths?: readonly string[] | undefined;
  readonly segments?: readonly SegmentEntry[] | undefined;
  readonly settingsSegment?: SettingsSegmentEntry | undefined;
  readonly templateSha: string;
  readonly version: string;
  readonly workspaceSegment?: WorkspaceSegmentEntry | undefined;
}
interface InstallConfig {
  readonly bundle?: string | undefined;
  readonly dest?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly exitCode?: boolean | undefined;
  readonly ifCurrent?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly manifest?: string | undefined;
  readonly noHeader?: boolean | undefined;
  readonly quiet?: boolean | undefined;
  readonly ref: string;
  readonly repo?: string | undefined;
  readonly status?: boolean | undefined;
  readonly thin?: boolean | undefined;
  readonly wire?: boolean | undefined;
}
interface ThinConfig {
  readonly dest: string;
  readonly manifest: BundleManifest;
}
interface WorkspaceSegmentEntry {
  readonly fleetKeys: readonly string[];
  readonly path: string;
  readonly sha256: string;
}
interface SegmentEntry {
  readonly commentStyle: FleetCommentStyle;
  readonly path: string;
  readonly sha256: string;
}
interface SettingsSegmentEntry {
  readonly path: string;
  readonly sha256: string;
}
interface SpliceConfig {
  readonly commentStyle: FleetCommentStyle;
  readonly fleetBlock: string;
  readonly target: string;
}
interface TarExtractConfig {
  readonly archive: string;
  readonly destination: string;
  readonly platform: NodeJS.Platform;
}
/**
 * Normalize bundle-manifest paths to their portable `/` wire format.
 */
declare function normalizeBundlePath(filePath: string): string;
declare function tarExecutable(platform: NodeJS.Platform, systemRoot: string | undefined): string;
/**
 * Build extraction arguments for the platform-selected tar executable.
 */
declare function tarExtractArgs(config: TarExtractConfig): string[];
declare function errorMessage(e: unknown): string;
/**
 * Compute the SHA-256 hex digest of a Buffer — used for both files (byte-
 * identical verification) and fleet-block segments.
 */
declare function computeSha256(buf: Buffer): string;
/**
 * The open marker line for a given comment style — canonical short-tag
 * bare-tag form, matching the grammar used by fleet-markers.mts on the
 * producer side. Inlined here so this file stays dep-0 — it cannot import
 * the wheelhouse's fleet-markers module.
 */
declare function beginMarker(style: FleetCommentStyle): string;
/**
 * The close marker line for a given comment style — canonical short-tag
 * bare-tag form.
 */
declare function endMarker(style: FleetCommentStyle): string;
/**
 * The transitional long-form tag, bare form — every existing fleet member's
 * CLAUDE.md / .gitignore / .gitattributes still carries this pre-rename.
 * spliceFleetBlock matches it alongside the short-tag form, so a
 * not-yet-recascaded member is still found and re-spliced in one pass.
 */
declare function legacyTagBeginMarker(style: FleetCommentStyle): string;
declare function legacyTagEndMarker(style: FleetCommentStyle): string;
/**
 * Returns the BEGIN/END keyword marker form (long-form tag) for a style — an
 * older transition, predating the short-tag rename. spliceFleetBlock matches
 * it alongside the bare-tag forms, so a file carrying any of the three forms
 * is re-spliced in one pass.
 */
declare function legacyBeginMarker(style: FleetCommentStyle): string;
declare function legacyEndMarker(style: FleetCommentStyle): string;
/**
 * Splice the canonical fleet block into `target`. If `target` already contains
 * the open/close markers (short-tag bare, long-form tag bare, or legacy
 * BEGIN/END form), the content between them (markers inclusive) is replaced.
 * If markers are absent:
 * - `html` style (CLAUDE.md, README): insert before the first level-2 heading
 * (`## `) with i > 0, or append at end.
 * - other styles: append with a leading blank line separator.
 */
declare function spliceFleetBlock(config: SpliceConfig): string;
declare function run(cmd: string, args: readonly string[]): void;
declare function segmentFileName(relativePath: string): string;
declare function readManifest(manifestPath: string): BundleManifest;
/**
 * Verify every file in `manifest.files` against its expected SHA-256 digest.
 * Returns a list of problem descriptions — empty means all verified. A single
 * mismatch must abort the whole install (fail closed).
 */
declare function verifyBundleFiles(filesDir: string, manifest: BundleManifest): string[];
/**
 * Verify every generic block segment and the specialized Claude settings
 * segment against its expected SHA-256. A mismatch is just as fatal as a file
 * mismatch — the merge result would silently differ from producer intent.
 */
declare function verifySegments(segmentsDir: string, manifest: BundleManifest): string[];
//#endregion
//#region scripts/repo/gen/bootstrap/src/applied-state.d.mts
declare function resolveSettingsPath(dest: string): string | undefined;
/**
 * Default bundle ref for a member — `bundle.ref` in its wheelhouse settings
 * file. Lets install-fleet (and the prepare/CI wires) omit an explicit --ref so
 * the pin lives in exactly one place. Returns undefined when absent/malformed.
 */
declare function readBundleRef(dest: string): string | undefined;
interface BundleConfig {
  readonly ref: string | undefined;
  readonly cascadeSha: string | undefined;
}
/**
 * Read the member's full pinned `bundle` block (ref + cascadeSha) from the
 * wheelhouse settings file. The lock-step verify + the `fleet:status` verb need
 * BOTH halves — `readBundleRef` returns only the ref for the fetch default.
 * Returns both as undefined when the file is absent / malformed.
 */
declare function readBundleConfig(dest: string): BundleConfig;
declare function readAppliedRef(dest: string): string | undefined;
/**
 * The file list the LAST applied bundle owned, or undefined when no record
 * exists. Feeds pruneStaleFleetFiles — see APPLIED_FILES_MARKER.
 */
declare function readAppliedFiles(dest: string): string[] | undefined;
/**
 * Record the manifest file list the apply just placed, replacing the previous
 * record. Written after a successful apply only, beside the applied-ref
 * marker.
 */
declare function writeAppliedFiles(dest: string, files: readonly string[]): void;
declare function writeAppliedRef(dest: string, ref: string): void;
//#endregion
//#region scripts/repo/gen/bootstrap/src/bundle-source.d.mts
type BundleFetchFn = (config: {
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}) => Promise<FetchedFiles>;
interface FetchedFiles {
  readonly manifest: string;
  readonly tarball: string;
}
interface FetchedBundle extends FetchedFiles {
  readonly source: 'gh-release' | 'ghcr';
}
/**
 * Derive the GHCR fleet-pack package repo from the gh `owner/repo`. GHCR
 * package paths are lowercase: `SocketDev/socket-wheelhouse` →
 * `socketdev/socket-wheelhouse/fleet-pack`.
 */
declare function ghcrBundleRepo(repo: string): string;
/**
 * Extract just the release-bundle manifest from the bundle tarball root (the
 * tarball ships it beside files/ + segments/), so the GHCR path yields the same
 * on-disk `sourceManifest` file the gh-release path downloads separately.
 */
declare function extractManifestFromTarball(tarball: string, destDir: string): string;
/**
 * Default GHCR fetch: anonymous OCI pull of the fleet-pack tarball, then pull
 * the manifest out of it. Throws on any failure so the selector can fall back.
 */
declare function ghcrFetchBundle(config: {
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}): Promise<FetchedFiles>;
/**
 * Default GitHub-Release fetch (the fallback): `gh release download` of the
 * tarball + manifest assets. Throws with an actionable message when the release
 * lacks either asset.
 */
declare function ghReleaseFetchBundle(config: {
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}): Promise<FetchedFiles>;
/**
 * Fetch the fleet bundle: GHCR primary, GitHub-Release fallback. Tries the
 * anonymous OCI pull first; on ANY failure logs the reason to STDERR and falls
 * back to `gh release download`. Returns the on-disk tarball + manifest paths
 * plus which source served them. The injectable `ghcrFetch` / `ghFetch` seams
 * let tests drive both paths without network.
 */
declare function fetchBundleSource(config: {
  readonly ghFetch?: BundleFetchFn | undefined;
  readonly ghcrFetch?: BundleFetchFn | undefined;
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}): Promise<FetchedBundle>;
//#endregion
//#region scripts/repo/gen/bootstrap/src/ghcr-fetch.d.mts
declare const GHCR_HOST = "ghcr.io";
declare const MANIFEST_ACCEPT: string;
interface GhcrHttpResponse {
  readonly body: Buffer;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly status: number;
}
interface GhcrHttpOptions {
  readonly headers?: Record<string, string> | undefined;
}
type GhcrHttpGetFn = (url: string, options?: GhcrHttpOptions | undefined) => Promise<GhcrHttpResponse>;
interface AuthChallenge {
  readonly realm: string;
  readonly scope: string | undefined;
  readonly service: string | undefined;
}
interface OciLayer {
  readonly annotations?: Record<string, string> | undefined;
  readonly digest?: string | undefined;
  readonly mediaType?: string | undefined;
}
interface OciManifest {
  readonly config?: {
    digest?: string | undefined;
  } | undefined;
  readonly layers?: readonly OciLayer[] | undefined;
  readonly manifests?: ReadonlyArray<{
    digest?: string | undefined;
  }> | undefined;
  readonly mediaType?: string | undefined;
}
interface PullBundleConfig {
  readonly destDir: string;
  readonly httpFn?: GhcrHttpGetFn | undefined;
  readonly registry?: string | undefined;
  readonly repo: string;
  readonly tag: string;
}
/**
 * Read the first value of a possibly-array HTTP header.
 */
declare function firstHeader(value: string | string[] | undefined): string | undefined;
/**
 * Dep-0 HTTPS GET returning raw bytes. Follows storage redirects (GHCR serves
 * blobs from a redirected backend), dropping the Authorization header on any
 * redirect so a pre-signed storage URL is never handed a stale bearer.
 */
declare function httpGet(url: string, options?: GhcrHttpOptions | undefined): Promise<GhcrHttpResponse>;
/**
 * Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."`
 * challenge into its realm/service/scope. Returns undefined for a non-Bearer or
 * realm-less header. Reimplements docker.mts parseWwwAuthenticate dep-0.
 */
declare function parseWwwAuthenticate(header: string): AuthChallenge | undefined;
/**
 * The GHCR anonymous pull-token URL for a repository.
 */
declare function ghcrTokenUrl(repo: string, registry: string): string;
/**
 * Extract the bearer token from a token-endpoint JSON body (either `token` or
 * `access_token`). Returns undefined when neither is present / parseable.
 */
declare function tokenFromBody(body: Buffer): string | undefined;
/**
 * Obtain an anonymous pull token. Hits the documented token endpoint first; on
 * anything but a usable token, falls back to the 401 WWW-Authenticate challenge
 * form (probe /v2/, follow the advertised realm). Fails loud when no token can
 * be obtained.
 */
declare function getGhcrToken(repo: string, registry: string, httpFn?: GhcrHttpGetFn): Promise<string>;
/**
 * GET one manifest by tag or digest. Resolves a multi-arch index to its first
 * sub-manifest so a concrete image manifest (carrying the artifact layer) is
 * always returned. Fails loud on a non-2xx.
 */
declare function fetchOciManifest(repo: string, ref: string, token: string, registry: string, httpFn?: GhcrHttpGetFn): Promise<OciManifest>;
/**
 * Choose the tarball layer from an artifact manifest: prefer a layer whose
 * `org.opencontainers.image.title` ends in `.tar.gz`, then a gzip/tar media
 * type, else the sole layer. Throws when no usable layer exists.
 */
declare function pickBundleLayer(manifest: OciManifest): OciLayer;
/**
 * GET a blob by digest (following the storage redirect). Fails loud on a
 * non-2xx.
 */
declare function fetchBlob(repo: string, digest: string, token: string, registry: string, httpFn?: GhcrHttpGetFn): Promise<Buffer>;
/**
 * The SHA-256 hex digest of a Buffer.
 */
declare function sha256Hex(buf: Buffer): string;
/**
 * Pull the fleet-pack tarball from GHCR and write it to `destDir`. Verifies
 * the blob's SHA-256 against the manifest layer digest before writing — a
 * mismatch aborts (fail closed). Returns the written tarball path.
 */
declare function pullFleetBundleTarball(config: PullBundleConfig): Promise<string>;
//#endregion
//#region scripts/repo/gen/bootstrap/src/install-prune.d.mts
/**
 * Apply the manifest's per-repo-owned file MOVES (`movedPaths`) — the rename
 * half of relocating a file the fleet does NOT byte-mirror. A plain tombstone
 * would delete the member's only copy with nothing in the bundle to re-create
 * it (the file is repo-owned; the bundle never ships it), so the move renames
 * `from` → `to` when `to` is absent — repo-owned content survives
 * byte-for-byte — and deletes a stale `from` leftover once `to` exists. Runs
 * BEFORE removeTombstonedPaths. Idempotent: a missing `from` is a no-op.
 * Belt: a move whose `from` the current manifest ships a file at/under is
 * skipped, so a bad producer entry can never displace freshly placed payload.
 * Returns the count of paths acted on (renamed or cleaned up).
 */
declare function applyMovedPaths(dest: string, manifest: FleetFileManifest): number;
/**
 * Delete the manifest's TOMBSTONED paths (`removedPaths`) — files or whole
 * dirs a past bundle shipped that the wheelhouse has since moved/retired. The
 * applied-files prune below only covers a member whose record OWNED the old
 * path; a fresh clone or a member whose record began after the move keeps the
 * orphan forever (the v1.0.12 `.github/actions/fleet/lib` → `_shared` move did
 * exactly that fleet-wide). Manifest-scoped like the prune — never a directory
 * walk. Belt: a tombstone the current manifest ships a file at/under is
 * skipped, so a bad producer entry can never delete freshly placed payload.
 */
declare function removeTombstonedPaths(dest: string, manifest: FleetFileManifest): number;
/**
 * Prune stale fleet files so a fetch is a true SYNC (place + prune) — scoped
 * to what the bundle PREVIOUSLY owned. Only a file the last-applied manifest
 * shipped (the applied-files record, see readAppliedFiles) that the current
 * manifest no longer ships is deleted. The prune list comes from MANIFESTS,
 * never a directory walk, so repo-owned files that merely live beside the
 * fleet payload — per-repo EXPECTED variants like
 * `.config/fleet/tsconfig.check.json`, `.gitkeep` seeds, cascade-only
 * release-excluded scripts under `scripts/fleet/` — can never be collateral.
 * With no record (fresh clone, or the first refresh that introduces the
 * record) nothing is pruned; the record starts with this apply and the next
 * refresh prunes precisely.
 */
declare function pruneStaleFleetFiles(dest: string, manifest: FleetFileManifest, previousFiles: readonly string[] | undefined): number;
//#endregion
//#region scripts/repo/gen/bootstrap/src/install.d.mts
/**
 * Place every verified bundle file from `filesDir` into `dest`, creating
 * parent directories as needed. Sentinel-scoped ONLY for the DESIGNATED
 * segment files (FLEET_CANONICAL_SPLICE_FILES): the bundle bytes replace
 * everything through the fleet-canonical end sentinel and the member tail
 * after it survives byte-for-byte — the repo-local oxlintrc ignorePatterns,
 * the derived .prettierignore lockstep-mirrors block. A whole-file copy here
 * wiped exactly those tails on every bootstrap-path refresh. Every other file
 * is a plain byte copy — the PATH gate is load-bearing: content-only gating
 * spliced ANY placed file merely mentioning the sentinel token, stitching
 * stale member tails onto fresh bundle heads (the v1.0.14 fetcher-chimera
 * incident). A designated file landing for the first time also byte-copies.
 */
declare function installFiles(filesDir: string, dest: string, manifest: BundleManifest): void;
/**
 * Untrack the bundle's GENERATED build outputs (`manifest.generatedPaths`)
 * from the git index after placement. The bundle SHIPS these files — placement
 * writes them to disk — while the fleet gitignore block ignores them and
 * `generated-outputs-are-untracked` forbids TRACKING them. A member that
 * historically committed one (fleet-pack.cjs et al., before the ignore existed)
 * heals on the next refresh: the file stays on disk, but leaves the index.
 * Non-fatal by design — a non-git dest or an already-clean index is a no-op
 * (`--ignore-unmatch`).
 */
declare function untrackGeneratedOutputs(dest: string, generatedPaths: readonly string[] | undefined): void;
/**
 * Apply each fleet-canonical segment: read the `.fleetblock` file, read the
 * consumer's existing file (or start with an empty string), splice the block
 * in, and write back.
 */
declare function installSegments(segmentsDir: string, dest: string, manifest: BundleManifest): void;
/**
 * Merge the release's canonical Claude settings section into the consumer's
 * hybrid file. Fleet keys are replaced; repo-owned top-level settings and
 * `.claude/hooks/repo/` registrations survive. Malformed JSON fails closed.
 */
declare function installSettingsSegment(segmentsDir: string, dest: string, manifest: BundleManifest): number;
/**
 * If the manifest includes a `workspaceSegment`, merge the fleet-managed
 * sections into the consumer's `pnpm-workspace.yaml`. Returns 0 on success,
 * 1 on any error (fail-closed).
 */
declare function installWorkspaceSegment(segmentsDir: string, dest: string, manifest: BundleManifest): number;
declare const SYNC_FLEET_SCRIPT = "node scripts/repo/bootstrap/fleet.mjs";
declare const PREPARE_FETCH = "node scripts/repo/bootstrap/prepare.mts";
declare const FLEET_STATUS_SCRIPT = "node scripts/repo/bootstrap/fleet.mjs --status";
/**
 * Wire the consumer's package.json for thin distribution: a `sync-fleet` script
 * (manual full re-fetch) and the `prepare` BELT — the idempotent auto-fetch
 * prepended so a fresh clone / CI `pnpm install` repopulates the untracked
 * fleet payload BEFORE the (itself-untracked) install-git-hooks step + any
 * chained build runs. Idempotent: skips when both are already in place. No-ops
 * if package.json is absent. (Dep-0 file — raw JSON, not EditablePackageJson.)
 */
declare function wirePackageJson(dest: string): void;
declare function normalizeManifestEntryPath(entry: {
  path: string;
}): string;
interface FleetFileManifest {
  files: Record<string, string>;
  movedPaths?: ReadonlyArray<{
    from: string;
    to: string;
  }> | undefined;
  removedPaths?: readonly string[] | undefined;
  segments?: ReadonlyArray<{
    path: string;
  }> | undefined;
  settingsSegment?: {
    path: string;
  } | undefined;
}
/**
 * Compute the gitignore entries for thin mode — the wholly-fleet files that the
 * download/fetch action supplies, so they need not be git-tracked. Hybrid paths
 * (manifest.segments — CLAUDE.md, pnpm-workspace.yaml, …) are merged per repo
 * and stay tracked, so they're excluded. The DESIGNATED sentinel-splice files
 * are hybrids too — they carry a member tail below the fleet-canonical end
 * sentinel that only the member's git history preserves; untracking one turns
 * the next fresh clone into a tail wipe.
 *
 * The GitHub CI surface (`isAlwaysTrackedGitHubSurface` —
 * `.github/workflows/**` and `.github/actions/fleet/**`) is HARD-excluded too:
 * GitHub reads a workflow's cron and a `uses: ./.github/actions/...` composite
 * from the committed default-branch tree BEFORE any fetch step runs, so
 * untracking one breaks CI outright. The bundle still ships them; they reach
 * members in the cascade COMMIT, tracked.
 *
 * EVERY entry is EXPLICIT — one line per bundle file, never a blanket
 * `…/fleet/` dir entry. A dir blanket also swallows any future non-bundle
 * file that lands beside the payload, hiding it from git entirely; the
 * explicit list ignores exactly what the bundle supplies and nothing else.
 * The sync-prune is manifest-scoped too — see pruneStaleFleetFiles.
 */
declare function thinIgnoreEntries(manifest: FleetFileManifest): string[];
/**
 * Apply thin mode: write a fleet-managed `.gitignore` block listing the
 * wholly-fleet bundle paths (see thinIgnoreEntries) plus `.agents/`, then
 * untrack them from git so the fetch action repopulates them going forward.
 */
declare function applyThinMode(config: ThinConfig): void;
//#endregion
//#region scripts/repo/gen/bootstrap/src/lockstep.d.mts
type LockStepStateName = 'current' | 'out-of-sync' | 'update-available';
interface LockStepConfig {
  readonly ref: string;
  readonly cascadeSha: string;
}
interface LockStepInputs {
  readonly config: LockStepConfig;
  readonly pinnedTemplateSha: string | undefined;
  readonly newestTemplateSha: string | undefined;
  readonly newestRef: string | undefined;
}
interface LockStepState {
  readonly state: LockStepStateName;
  readonly inLockStep: boolean;
  readonly updateAvailable: boolean;
  readonly config: LockStepConfig;
  readonly pinnedTemplateSha: string | undefined;
  readonly newestTemplateSha: string | undefined;
  readonly newestRef: string | undefined;
}
interface RefValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}
/**
 * Validate a `bundle.ref` value at WRITE time. Rejects an empty, fuzzy, ranged,
 * or aliased ref — only an exact `fleet-pack-<hex>` tag is legal. Returns the
 * list of problems (empty === valid).
 */
declare function validateRef(ref: unknown): RefValidation;
/**
 * Validate a `bundle.cascadeSha` value at WRITE time. Rejects anything that is
 * not a bare 40-char lowercase hex SHA (no `v` prefix, no range, no alias).
 */
declare function validateCascadeSha(cascadeSha: unknown): RefValidation;
/**
 * Validate a complete `bundle` block (both fields together). Used by the
 * write-time gate in the config reader + the cascade stamper.
 */
declare function validateBundleBlock(bundle: unknown): RefValidation;
/**
 * Resolve the lock-step state from the PARSED inputs (never a substring scan).
 * Pure — no IO — so the three states + their exit codes unit-test offline.
 *
 * - CURRENT: inLockStep AND no newer release.
 * - UPDATE-AVAILABLE: inLockStep but a newer release exists.
 * - OUT-OF-SYNC: cascadeSha !== pinnedTemplateSha (broken invariant).
 *
 * When `pinnedTemplateSha` is undefined (the ref's release can't be found) the
 * invariant cannot be confirmed, so the state is OUT-OF-SYNC — fail loud rather
 * than assume current.
 */
declare function resolveLockStepState(inputs: LockStepInputs): LockStepState;
/**
 * The terraform `-detailed-exitcode`-style exit code for a resolved state.
 * 0  CURRENT, or UPDATE-AVAILABLE without --exit-code.
 * 10 UPDATE-AVAILABLE WITH --exit-code (a clean "drift detected" signal).
 * 1  OUT-OF-SYNC — ALWAYS (broken invariant, fail loud regardless of flags).
 */
declare function lockStepExitCode(state: LockStepState, options?: {
  exitCode?: boolean | undefined;
} | undefined): number;
declare const ERR_LOCKSTEP_MISMATCH = "ERR_WHEELHOUSE_LOCKSTEP_MISMATCH";
interface LockStepErrorParts {
  readonly ref: string;
  readonly pinnedTemplateSha: string | undefined;
  readonly cascadeSha: string;
}
/**
 * Build the pnpm-style lock-step mismatch error from the PARSED fields (never
 * stitched from substrings). Lines: code + What / Where / Wanted / Saw / Fix.
 * Prints BOTH the raw ref and the resolved release templateSha so the operator
 * can see which side drifted.
 */
declare function formatLockStepError(parts: LockStepErrorParts): string;
declare const UPDATE_NOTIFIER_OPT_OUT_ENV = "WHEELHOUSE_NO_UPDATE_NOTIFIER";
interface NoticeStore {
  readonly lastCheckMs: number;
  readonly lastSeenRef: string | undefined;
}
declare function readNoticeStore(dest: string): NoticeStore | undefined;
declare function writeNoticeStore(dest: string, store: NoticeStore): void;
interface NoticeDecisionInputs {
  readonly updateAvailable: boolean;
  readonly newestRef: string | undefined;
  readonly store: NoticeStore | undefined;
  readonly nowMs: number;
  readonly ci: boolean;
  readonly optedOut: boolean;
}
/**
 * Decide whether the passive update notice should print. Pure so the throttle +
 * CI-suppress + opt-out unit-test offline. The notice fires only when: a newer
 * release exists, we are NOT in CI, NOT opted out, and either the store is
 * empty, ≥24h have passed since the last check, OR the newest ref changed since
 * last seen (a fresh release jumps the throttle).
 */
declare function shouldShowNotice(inputs: NoticeDecisionInputs): boolean;
/**
 * Format the boxed passive notice. NAMES the re-cascade as the action (never a
 * bare re-fetch). Honors NO_COLOR by dropping the box-drawing emphasis to plain
 * ASCII when `color` is false.
 */
declare function formatUpdateNotice(config: {
  readonly newestRef: string;
  readonly color: boolean;
}): string;
//#endregion
//#region scripts/repo/gen/bootstrap/src/resolve.d.mts
/**
 * @file GitHub release resolution and lock-step assertion helpers.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here shell out to `gh` (dep-0: no socket-lib) or are pure
 *   logic; none do filesystem writes.
 *   Lock-step note: assertLockStep enforces the cascadeSha === templateSha
 *   invariant but does not resolve refs itself — see resolveReleaseTemplateSha.
 */
/**
 * Assert the lock-step invariant before applying a release: the member's pinned
 * `bundle.cascadeSha` MUST equal the release's `templateSha`.
 * `--frozen-lockfile` semantics — a hard fail (never apply a mismatched
 * release). Returns true when intact OR when the member declares no
 * `cascadeSha` (a non-lock-step member — the legacy ref-only pin still
 * fetches). Logs the parsed error + returns false on mismatch.
 */
declare function assertLockStep(config: {
  readonly cascadeSha: string | undefined;
  readonly manifestTemplateSha: string;
  readonly ref: string;
}): boolean;
/**
 * Resolve the NEWEST `fleet-pack-<hex>` release tag via `gh release list`.
 * Returns the latest tag, or undefined when none / offline. The list is
 * newest-first.
 */
declare function resolveNewestRef(repo: string): string | undefined;
/**
 * Resolve a release's `templateSha` from its manifest asset via gh. Dep-0:
 * shells `gh release download <ref> --pattern release-bundle-manifest.json` and
 * reads the stamped field. Returns undefined when the release / asset / field
 * is absent (offline, no such tag) — the caller decides whether that's fatal.
 */
declare function resolveReleaseTemplateSha(ref: string, repo: string): string | undefined;
//#endregion
//#region scripts/repo/gen/bootstrap/src/status.d.mts
/**
 * Fire the passive update notice opportunistically (update-notifier style). The
 * caller already resolved a newer release exists; this throttles to once/24h
 * via the out-of-tree store, suppresses in CI, honors the opt-out env +
 * NO_COLOR, and NAMES the re-cascade. NEVER weakens the fetch-path verify or
 * the status hard-fail — it only silences the box. Returns true when a notice
 * was printed.
 */
declare function maybeShowUpdateNotice(config: {
  readonly dest: string;
  readonly updateAvailable: boolean;
  readonly newestRef: string | undefined;
}): boolean;
declare function printStatusReport(state: LockStepState, config: {
  noHeader: boolean;
}): void;
/**
 * Stable-keyed JSON shape for `fleet:status --json`. Keys never change between
 * states so a script can read them unconditionally.
 */
declare function statusJson(state: LockStepState): Record<string, unknown>;
//#endregion
//#region scripts/repo/gen/bootstrap/src/yaml-merge.d.mts
interface MergeWorkspaceConfig {
  readonly bundleFleetSections: string;
  readonly consumerYaml: string;
  readonly fleetKeys: readonly string[];
}
/**
 * Parse a YAML string into an ordered list of top-level key blocks. Each block
 * owns all lines from the key line up to (not including) the next column-0 key
 * line or EOF.
 */
declare function parseYamlKeyBlocks(yaml: string): Array<{
  key: string;
  lines: string[];
}>;
interface YamlEntryChunk {
  id: string;
  lines: string[];
}
/**
 * Split a top-level key block's BODY lines into entry chunks. A chunk starts
 * at a map-entry or list-item line at the block's entry indent; comment and
 * blank lines BEFORE an entry attach to it (they document what follows);
 * deeper-indented lines are continuations. Returns `undefined` when the body
 * has no recognizable entries (scalar block — nothing nested to merge).
 */
declare function parseYamlEntryChunks(bodyLines: readonly string[]): YamlEntryChunk[] | undefined;
/**
 * Merge one fleet-managed top-level key block ENTRY-SCOPED — the workspace
 * analog of the Claude-settings splice that keeps repo hook registrations
 * inside the fleet-owned `hooks` key. Fleet-shipped entries (present in the
 * bundle block) take the bundle's text, comments included; member-local
 * entries (present only in the consumer block) survive in their original
 * order after the fleet set. Scalar-shaped blocks (`saveExact: true`) have no
 * nested entries, so the bundle block replaces wholesale. Trailing blank lines
 * follow the consumer block so inter-block spacing is preserved.
 */
declare function mergeYamlKeyBlock(bundleBlock: {
  key: string;
  lines: string[];
}, consumerBlock: {
  key: string;
  lines: string[];
}): {
  key: string;
  lines: string[];
};
/**
 * Merge the fleet-managed workspace sections from `bundleFleetSections` into
 * `consumerYaml`, scoped to the keys listed in `fleetKeys` — and, within each
 * fleet key, scoped to the ENTRIES the bundle ships (mergeYamlKeyBlock):
 * member-local nested entries (repo-specific `catalog:`/`overrides:` pins,
 * soak-exclude items, …) survive a refresh instead of being wholesale-dropped.
 * Non-fleet keys (including `packages:`) are preserved byte-exact. Throws on
 * ambiguous input.
 */
declare function mergeWorkspaceYaml(config: MergeWorkspaceConfig): string;
//#endregion
//#region scripts/repo/gen/bootstrap/src/fleet.d.mts
declare function resolveRepoRoot(startDir: string): string;
declare function parseArgs(argv: readonly string[]): InstallConfig;
/**
 * Render the `fleet:status` report. Read-only — NEVER mutates. Resolves the
 * pinned release's templateSha + the newest release, builds the lock-step
 * state, prints the table / JSON / line, and returns the terraform-style exit
 * code (0 CURRENT, 0|10 UPDATE-AVAILABLE, 1 OUT-OF-SYNC).
 */
declare function runStatus(config: InstallConfig): number;
/**
 * Download, verify, and apply the fleet bundle identified by `config.ref`.
 * Returns 0 on success, 1 on any error.
 */
declare function installFleet(config: InstallConfig): Promise<number>;
declare function isMainModule(): boolean;
//#endregion
export { AuthChallenge, BundleConfig, BundleFetchFn, BundleManifest, ERR_LOCKSTEP_MISMATCH, FLEET_STATUS_SCRIPT, FetchedBundle, FetchedFiles, FleetCommentStyle, FleetFileManifest, GHCR_HOST, GhcrHttpGetFn, GhcrHttpOptions, GhcrHttpResponse, InstallConfig, LockStepConfig, LockStepErrorParts, LockStepInputs, LockStepState, LockStepStateName, MANIFEST_ACCEPT, MergeWorkspaceConfig, NoticeDecisionInputs, NoticeStore, OciLayer, OciManifest, PREPARE_FETCH, PullBundleConfig, RefValidation, SYNC_FLEET_SCRIPT, SegmentEntry, SettingsSegmentEntry, SpliceConfig, TarExtractConfig, ThinConfig, UPDATE_NOTIFIER_OPT_OUT_ENV, WorkspaceSegmentEntry, YamlEntryChunk, applyMovedPaths, applyThinMode, assertLockStep, beginMarker, computeSha256, endMarker, errorMessage, extractManifestFromTarball, fetchBlob, fetchBundleSource, fetchOciManifest, firstHeader, formatLockStepError, formatUpdateNotice, getGhcrToken, ghReleaseFetchBundle, ghcrBundleRepo, ghcrFetchBundle, ghcrTokenUrl, httpGet, installFiles, installFleet, installSegments, installSettingsSegment, installWorkspaceSegment, isMainModule, legacyBeginMarker, legacyEndMarker, legacyTagBeginMarker, legacyTagEndMarker, lockStepExitCode, maybeShowUpdateNotice, mergeWorkspaceYaml, mergeYamlKeyBlock, normalizeBundlePath, normalizeManifestEntryPath, parseArgs, parseWwwAuthenticate, parseYamlEntryChunks, parseYamlKeyBlocks, pickBundleLayer, printStatusReport, pruneStaleFleetFiles, pullFleetBundleTarball, readAppliedFiles, readAppliedRef, readBundleConfig, readBundleRef, readManifest, readNoticeStore, removeTombstonedPaths, resolveLockStepState, resolveNewestRef, resolveReleaseTemplateSha, resolveRepoRoot, resolveSettingsPath, run, runStatus, segmentFileName, sha256Hex, shouldShowNotice, spliceFleetBlock, statusJson, tarExecutable, tarExtractArgs, thinIgnoreEntries, tokenFromBody, untrackGeneratedOutputs, validateBundleBlock, validateCascadeSha, validateRef, verifyBundleFiles, verifySegments, wirePackageJson, writeAppliedFiles, writeAppliedRef, writeNoticeStore };