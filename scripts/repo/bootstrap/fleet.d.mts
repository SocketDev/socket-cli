//#region template/base/universal/scripts/fleet/lib/conditional-config.d.mts
type ConfigFlag = 'bundlesVendoredDeps' | 'hasGhcr' | 'hasNapi' | 'hasPrebakes' | 'hasRust' | 'isGithubAction';
//#endregion
//#region scripts/repo/gen/bootstrap/src/conditional-files.d.mts
interface ConditionalManifestGroup {
  readonly marker?: string | undefined;
  readonly capability?: string | undefined;
  readonly buildType?: string | undefined;
  readonly configFlag?: ConfigFlag | undefined;
  readonly files: readonly string[];
}
//#endregion
//#region scripts/repo/gen/bootstrap/src/fleet-pack-manifest.d.mts
export declare function normalizeManifestEntryPath(entry: {
  path: string;
}): string;
export interface FleetFileManifest {
  conditionalScopedFiles?: readonly ConditionalManifestGroup[] | undefined;
  /**
   * Hook payloads gated on a member capability (stamped from each hook's
   * `// @capability <name>` header at pack build time): placed only when the
   * member declares it.
   */
  capabilityScopedFiles?: ReadonlyArray<{
    capability: string;
    files: readonly string[];
  }> | undefined;
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
  shapeScopedFiles?: ReadonlyArray<{
    files: readonly string[];
    ship: ReadonlyArray<{
      from: string;
      types?: readonly string[] | undefined;
    }>;
  }> | undefined;
}
/**
 * Drop the manifest's shape-scoped files that the member's build shape does
 * not ship, so every downstream consumer (placement, prune, ignore refresh,
 * applied-files record) sees one consistent, member-effective file set. The
 * matcher mirrors releaseChecksumFiles in commit-cascade/repo-shape.mts;
 * the group DATA is stamped by make-publish-bundle from that one source.
 * Fail-open: no stamped groups, or an unknown shape (absent/malformed member
 * config), returns the manifest untouched — a config problem must never
 * withhold payload.
 */
/**
 * Drop the manifest's capability-scoped hook payloads the member does not
 * declare, so a `@capability cargo` hook never lands in a repo with no cargo
 * capability — the pack-side twin of the cascade's dirMirrorSkipPredicate
 * capability gate. Fails OPEN on an unknown capabilities read (absent or
 * malformed settings file): a config problem must never withhold payload.
 * The prune sees the same filtered set, so a wrongly placed copy heals on
 * the next fetch.
 */
export declare function filterManifestForCapabilities<T extends FleetFileManifest>(manifest: T, capabilities: readonly string[] | undefined): T;
export declare function filterManifestForShape<T extends FleetFileManifest>(manifest: T, shape: {
  from: string | undefined;
  type: string | undefined;
}): T;
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
export declare function fleetPackOwnedPaths(manifest: FleetFileManifest): string[];
/**
 * The lines currently inside a target's fleet-marked gitignore block, or an
 * empty array when the target has no block. Used to carry the cascade's rules
 * through the thin-mode splice instead of replacing them.
 */
export declare function extractFleetBlockLines(target: string): string[];
/**
 * Non-Claude harness surfaces the fleet GENERATES, never tracks.
 *
 * Each is a projection of a Claude-side source: `AGENTS.md` and the rule dirs
 * point at CLAUDE.md, `opencode.json` / `.codex/` project `.mcp.json`, and
 * `.agents/skills/` flattens `.claude/skills/` for the hosts that discover
 * skills one level deep. Regenerating them is cheap; tracking them means every
 * member carries a copy that drifts and conflicts.
 *
 * Listed here so a hydrate ignores AND untracks the whole set. Before this,
 * only `.agents/` was named, so a member that had committed `AGENTS.md` or
 * `.codex/` kept it tracked forever and the generator fought git on every run.
 */
export declare const HARNESS_ALIAS_PATHS: readonly string[];
/**
 * Strip a pre-marker untrack block: its header plus the run of path lines under
 * it, up to the next comment or end of file.
 *
 * Without markers there is nothing for {@link splicePackBlock} to replace, so
 * such a block is never regenerated and never pruned. Its entries then outlive
 * their reason: measured on ultrathink, a 2498-line legacy block still ignored
 * `.config/repo/vitest.config.mts` long after that file was reclassified from
 * bundle payload to a cascaded conditional-group file, so the member could not
 * track it and CI's fresh clone had no copy at all. Removing the whole run is
 * safe because the block is wholly tool-written — every line is an exact path,
 * so a hand-authored glob or directory ignore never lives inside it — and
 * anything the CURRENT manifest still ships is re-emitted into the managed
 * region on the same hydrate.
 */
export declare function stripLegacyPackBlock(target: string): string;
/**
 * Strip the old refresh's per-file untrack entries from INSIDE the `<fleet>`
 * region — they live in the fetcher-owned `<fleet-pack>` region now. The
 * cascade's own rules in the region are preserved untouched; a file with no
 * fleet region is returned unchanged. One-time migration shape: once a member
 * has been cleaned (or its cascade rewrote the block), this is a no-op.
 */
export declare function stripLegacyUntrackEntriesFromFleetBlock(target: string): string;
/**
 * Write the fetcher-owned `<fleet-pack>` `.gitignore` region: `.agents/` (the
 * regenerated agent mirror — dead weight in a thin consumer; the fetch
 * repopulates it) plus the wholly-fleet bundle untrack paths (see
 * fleetPackOwnedPaths). The region is REGENERATED from the manifest on every
 * run — replaced whole, so a stale entry from an earlier pack is pruned
 * instead of carried forward (the old append-only refresh accreted every
 * prior line forever). Hand-added ignores belong outside the markers and are
 * untouched, as is the cascade's `<fleet>` region — the two writers own
 * disjoint regions, so neither can discard the other's rules. The dep-0
 * bootstrap (`scripts/repo/bootstrap/`) is NOT listed: it ships via the
 * manual cascade, never the release bundle, so it never enters this untrack
 * set and stays tracked by default.
 *
 * This is the HALF that is safe to run unconditionally for a thin consumer. It
 * only edits `.gitignore`; it never touches the git index, so a member whose
 * payload is still tracked keeps every file it has committed (gitignore has no
 * effect on tracked paths). The index-mutating half lives in
 * untrackFleetPackPaths and stays behind an explicit `--thin`.
 */
export declare function refreshFleetPackIgnores(config: {
  dest: string;
  manifest: FleetFileManifest;
}): void;
/**
 * Apply thin mode: refresh the gitignore block (refreshFleetPackIgnores), then
 * untrack those paths from git so the fetch action repopulates them going
 * forward. The `git rm --cached` is the CONVERSION step and is destructive —
 * it drops files from the index — so it stays behind an explicit `--thin` and
 * is never inferred from repo state. socket-vscode is the case that forces the
 * distinction: it carries a pinned `bundle.ref` AND 81 still-tracked payload
 * files, so inferring the untrack from the pin alone would silently delete
 * them from its index on the next ordinary hydrate.
 */
export declare function untrackFleetPackPaths(config: UntrackFleetPackConfig): void;
//#endregion
//#region scripts/repo/gen/bootstrap/src/helpers.d.mts
export type FleetCommentStyle = 'hash' | 'html' | 'json' | 'slash';
export declare const HYBRID_BUNDLE_PATHS: ReadonlySet<string>;
export interface BundleManifest extends Pick<FleetFileManifest, 'capabilityScopedFiles' | 'conditionalScopedFiles' | 'shapeScopedFiles'> {
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
export interface InstallConfig {
  readonly bundle?: string | undefined;
  readonly dest?: string | undefined;
  /**
   * Materialize mirrors from this checkout's own template/base/universal
   * (producer).
   */
  readonly fromTemplate?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly exitCode?: boolean | undefined;
  readonly ifCurrent?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly manifest?: string | undefined;
  readonly noHeader?: boolean | undefined;
  readonly quiet?: boolean | undefined;
  readonly refreshTracked?: boolean | undefined;
  readonly ref: string;
  readonly repo?: string | undefined;
  readonly status?: boolean | undefined;
  readonly thin?: boolean | undefined;
  readonly wire?: boolean | undefined;
}
export interface UntrackFleetPackConfig {
  readonly dest: string;
  readonly manifest: BundleManifest;
}
export interface WorkspaceSegmentEntry {
  readonly fleetKeys: readonly string[];
  readonly path: string;
  readonly sha256: string;
}
export interface SegmentEntry {
  readonly commentStyle: FleetCommentStyle;
  readonly path: string;
  readonly sha256: string;
}
export interface SettingsSegmentEntry {
  readonly path: string;
  readonly sha256: string;
}
export interface SpliceConfig {
  readonly commentStyle: FleetCommentStyle;
  readonly fleetBlock: string;
  readonly target: string;
}
export interface TarExtractConfig {
  readonly archive: string;
  readonly destination: string;
  readonly platform: NodeJS.Platform;
}
/**
 * Normalize bundle-manifest paths to their portable `/` wire format.
 */
export declare function normalizeBundlePath(filePath: string): string;
export declare function tarExecutable(platform: NodeJS.Platform, systemRoot: string | undefined): string;
/**
 * Build extraction arguments for the platform-selected tar executable.
 */
export declare function tarExtractArgs(config: TarExtractConfig): string[];
export declare function errorMessage(e: unknown): string;
/**
 * Compute the SHA-256 hex digest of a Buffer — used for both files (byte-
 * identical verification) and fleet-block segments.
 */
export declare function computeSha256(buf: Buffer): string;
/**
 * The open marker line for a given comment style — canonical short-tag
 * bare-tag form, matching the grammar used by fleet-markers.mts on the
 * producer side. Inlined here so this file stays dep-0 — it cannot import
 * the wheelhouse's fleet-markers module.
 */
export declare function beginMarker(style: FleetCommentStyle): string;
/**
 * The close marker line for a given comment style — canonical short-tag
 * bare-tag form.
 */
export declare function endMarker(style: FleetCommentStyle): string;
/**
 * The open marker for the fetcher-owned `<fleet-pack>` gitignore region — the
 * manifest-derived untrack entries live here, OUTSIDE the cascade's `<fleet>`
 * region, so the cascade's block rewrite can never discard them (the defect
 * that re-tracked every hydrated payload file on the next cascade). Hash form
 * only: the region exists solely in `.gitignore`.
 */
export declare function packBeginMarker(): string;
/**
 * The close marker for the fetcher-owned `<fleet-pack>` gitignore region.
 */
export declare function packEndMarker(): string;
/**
 * Splice the fetcher-owned `<fleet-pack>` block into `target`. When the
 * markers exist the whole region (markers inclusive) is REPLACED — that is
 * what prunes a stale entry; the region is wholly fetcher-owned, so hand
 * ignores belong outside it. When absent, the block is appended at end of
 * file, after the cascade's `<fleet>` region and the member's `<repo>`
 * wrapper, so the fleet splice's repo-region adjacency is never broken.
 */
export declare function splicePackBlock(config: {
  readonly packBlock: string;
  readonly target: string;
}): string;
export interface FleetBlockSpan {
  readonly start: number;
  readonly end: number;
}
/**
 * Every balanced fleet block in `lines`, in document order. Each open marker
 * pairs with the NEXT close marker after it, and the scan resumes past that
 * close — so a file carrying several stacked blocks reports one span per block
 * rather than one span swallowing them all. An unclosed trailing open marker
 * yields no span: an unbalanced file is left for a human, never half-rewritten.
 */
export declare function findFleetBlockSpans(lines: readonly string[], commentStyle: FleetCommentStyle): FleetBlockSpan[];
/**
 * Splice the canonical fleet block into `target`. If `target` already contains
 * the open/close markers, the content between them (markers inclusive) is
 * replaced. A file carrying SEVERAL stacked blocks collapses to one: the first
 * is replaced with `fleetBlock` and every later one is deleted, so a member
 * whose file grew a second managed region ends up with one region instead of a
 * growing stack. Content outside the matched blocks is preserved
 * byte-for-byte, except that removing a block sandwiched between blank lines
 * drops one of them rather than leaving a doubled blank.
 * If markers are absent:
 *
 * - `html` style (CLAUDE.md, README): insert before the first level-2 heading
 *   (`## `) with i > 0, or append at end.
 * - Other styles: append with a leading blank line separator.
 */
export declare function spliceFleetBlock(config: SpliceConfig): string;
export declare function run(cmd: string, args: readonly string[]): void;
export declare function segmentFileName(relativePath: string): string;
export declare function readManifest(manifestPath: string): BundleManifest;
/**
 * Verify every file in `manifest.files` against its expected SHA-256 digest.
 * Returns a list of problem descriptions — empty means all verified. A single
 * mismatch must abort the whole install (fail closed).
 */
export declare function verifyBundleFiles(filesDir: string, manifest: BundleManifest): string[];
/**
 * Verify every generic block segment and the specialized Claude settings
 * segment against its expected SHA-256. A mismatch is just as fatal as a file
 * mismatch — the merge result would silently differ from producer intent.
 */
export declare function verifySegments(segmentsDir: string, manifest: BundleManifest): string[];
//#endregion
//#region scripts/repo/gen/bootstrap/src/applied-state.d.mts
export declare const SETTINGS_CANDIDATES: string[];
export declare function resolveSettingsPath(dest: string): string | undefined;
/**
 * Default bundle ref for a member — `bundle.ref` in its wheelhouse settings
 * file. Lets install-fleet (and the prepare/CI wires) omit an explicit --ref so
 * the pin lives in exactly one place. Returns undefined when absent/malformed.
 */
export declare function readBundleRef(dest: string): string | undefined;
export interface BundleConfig {
  readonly ref: string | undefined;
  readonly cascadeSha: string | undefined;
}
export interface MemberBuildShape {
  readonly from: string | undefined;
  readonly type: string | undefined;
}
/**
 * The member's build shape — `build.from` / `build.type` in its wheelhouse
 * settings file. Drives the manifest's shape-scoped file groups: a group is
 * placed only for shapes that ship it. Undefined fields on an absent or
 * malformed config read as "shape unknown", which the filter treats as
 * ship-everything so a config problem can never withhold payload.
 */
export declare function readBuildShape(dest: string): MemberBuildShape;
/**
 * The member's declared capabilities — the `capabilities` map in its
 * wheelhouse settings file (an empty or ABSENT map declares NONE, matching
 * the cascade-side gate). Drives the manifest's capability-scoped hook
 * groups: a `@capability`-tagged hook is placed only when the member
 * declares the capability.
 */
export declare function readDeclaredCapabilities(dest: string): string[];
/**
 * Read the member's full pinned `bundle` block (ref + cascadeSha) from the
 * wheelhouse settings file. The lock-step verify + the `fleet:status` verb need
 * BOTH halves — `readBundleRef` returns only the ref for the fetch default.
 * Returns both as undefined when the file is absent / malformed.
 */
export declare function readBundleConfig(dest: string): BundleConfig;
export declare function readAppliedRef(dest: string): string | undefined;
/**
 * The file list the LAST applied bundle owned, or undefined when no record
 * exists. Feeds pruneStaleFleetFiles — see APPLIED_FILES_MARKER.
 */
export declare function readAppliedFiles(dest: string): string[] | undefined;
/**
 * Record the manifest file list the apply just placed, replacing the previous
 * record. Written after a successful apply only, beside the applied-ref
 * marker.
 */
export declare function writeAppliedFiles(dest: string, files: readonly string[]): void;
export declare function writeAppliedRef(dest: string, ref: string): void;
//#endregion
//#region scripts/repo/gen/bootstrap/src/bundle-source.d.mts
export type BundleFetchFn = (config: {
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}) => Promise<FetchedFiles>;
export interface FetchedFiles {
  readonly manifest: string;
  readonly tarball: string;
}
export interface FetchedBundle extends FetchedFiles {
  readonly source: 'ghcr';
}
/**
 * Derive the GHCR fleet-pack package repo from the gh `owner/repo`. GHCR
 * package paths are lowercase: `SocketDev/socket-wheelhouse` →
 * `socketdev/socket-wheelhouse/fleet-pack`.
 */
export declare function ghcrBundleRepo(repo: string): string;
/**
 * Extract just the release-bundle manifest from the bundle tarball root (the
 * tarball ships it beside files/ + segments/), so the GHCR path yields the same
 * on-disk `sourceManifest` file the gh-release path downloads separately.
 */
export declare function extractManifestFromTarball(tarball: string, destDir: string): string;
/**
 * Default GHCR fetch: anonymous OCI pull of the fleet-pack tarball, then pull
 * the manifest out of it. Throws on any failure so the selector can fall back.
 */
export declare function ghcrFetchBundle(config: {
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}): Promise<FetchedFiles>;
/**
 * Fetch the fleet bundle from GHCR.
 *
 * GHCR is the only source. A GitHub-Release fallback used to sit behind this,
 * described in its own comment as transitional until the public GHCR package
 * existed. That package exists, and the pack no longer publishes a Release at
 * all, so the fallback could only ever fail now: it turned a clear GHCR error
 * into a confusing `gh` one and hid the real cause. The injected `ghcrFetch`
 * lets tests drive it without network.
 */
export declare function fetchBundleSource(config: {
  readonly ghcrFetch?: BundleFetchFn | undefined;
  readonly ref: string;
  readonly repo: string;
  readonly tmp: string;
}): Promise<FetchedBundle>;
//#endregion
//#region template/base/universal/scripts/fleet/constants/oci-media-types.d.mts
declare const OCI_MANIFEST_ACCEPT: string;
//#endregion
//#region scripts/repo/gen/bootstrap/src/ghcr-fetch.d.mts
export declare const GHCR_HOST = "ghcr.io";
export interface GhcrHttpResponse {
  readonly body: Buffer;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly status: number;
}
export interface GhcrHttpOptions {
  readonly headers?: Record<string, string> | undefined;
}
export type GhcrHttpGetFn = (url: string, options?: GhcrHttpOptions | undefined) => Promise<GhcrHttpResponse>;
export interface AuthChallenge {
  readonly realm: string;
  readonly scope: string | undefined;
  readonly service: string | undefined;
}
export interface OciLayer {
  readonly annotations?: Record<string, string> | undefined;
  readonly digest?: string | undefined;
  readonly mediaType?: string | undefined;
}
export interface OciManifest {
  /**
   * Manifest-level annotations. The pack carries
   * `org.opencontainers.image.revision`, the template SHA it was built from,
   * which is how a member resolves the newest pack from the moving tag.
   */
  readonly annotations?: Readonly<Record<string, string>> | undefined;
  readonly config?: {
    digest?: string | undefined;
  } | undefined;
  readonly layers?: readonly OciLayer[] | undefined;
  readonly manifests?: ReadonlyArray<{
    digest?: string | undefined;
  }> | undefined;
  readonly mediaType?: string | undefined;
}
export interface PullBundleConfig {
  readonly destDir: string;
  readonly httpFn?: GhcrHttpGetFn | undefined;
  readonly registry?: string | undefined;
  readonly repo: string;
  readonly tag: string;
}
/**
 * Read the first value of a possibly-array HTTP header.
 */
export declare function firstHeader(value: string | string[] | undefined): string | undefined;
/**
 * Dep-0 HTTPS GET returning raw bytes. Follows storage redirects (GHCR serves
 * blobs from a redirected backend), dropping the Authorization header on any
 * redirect so a pre-signed storage URL is never handed a stale bearer.
 */
export declare function httpGet(url: string, options?: GhcrHttpOptions | undefined): Promise<GhcrHttpResponse>;
/**
 * Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."`
 * challenge into its realm/service/scope. Returns undefined for a non-Bearer or
 * realm-less header. Reimplements docker.mts parseWwwAuthenticate dep-0.
 */
export declare function parseWwwAuthenticate(header: string): AuthChallenge | undefined;
/**
 * The GHCR anonymous pull-token URL for a repository.
 */
export declare function ghcrTokenUrl(repo: string, registry: string): string;
/**
 * Extract the bearer token from a token-endpoint JSON body (either `token` or
 * `access_token`). Returns undefined when neither is present / parseable.
 */
export declare function tokenFromBody(body: Buffer): string | undefined;
/**
 * `Authorization: Basic` for GHCR's token endpoint, built from the workflow
 * token when one is in the environment.
 *
 * A PUBLIC package needs none of this - anonymous pull is the common path and
 * stays first. A package that is private, or newly published and not yet made
 * public, answers the anonymous request with 403 and no token, which reads as
 * "confirm the package is public" and is unactionable inside a job that already
 * holds a credential for the same repo. GHCR accepts the workflow token as the
 * password with any username.
 *
 * Returns undefined when no token is in the environment, so a local run keeps
 * its anonymous behavior. Never logged: the value only ever becomes a header.
 */
export declare function ghcrBasicAuthHeader(env: Record<string, string | undefined>): string | undefined;
/**
 * Obtain a pull token. Hits the documented token endpoint first; on anything
 * but a usable token, falls back to the 401 WWW-Authenticate challenge form
 * (probe /v2/, follow the advertised realm), and finally retries the challenge
 * WITH the workflow token when the environment carries one. Fails loud when no
 * token can be obtained.
 */
export declare function getGhcrToken(repo: string, registry: string, httpFn?: GhcrHttpGetFn): Promise<string>;
/**
 * GET one manifest by tag or digest. Resolves a multi-arch index to its first
 * sub-manifest so a concrete image manifest that carries the artifact layer is
 * always returned. Fails loud on a non-2xx.
 */
export declare function fetchOciManifest(repo: string, ref: string, token: string, registry: string, httpFn?: GhcrHttpGetFn): Promise<OciManifest>;
/**
 * Choose the tarball layer from an artifact manifest: prefer a layer whose
 * `org.opencontainers.image.title` ends in `.tar.gz`, then a gzip/tar media
 * type, else the sole layer. Throws when no usable layer exists.
 */
export declare function pickBundleLayer(manifest: OciManifest): OciLayer;
/**
 * GET a blob by digest, following the storage redirect that GHCR issues for
 * blobs. Fails loud on a non-2xx.
 */
export declare function fetchBlob(repo: string, digest: string, token: string, registry: string, httpFn?: GhcrHttpGetFn): Promise<Buffer>;
/**
 * The SHA-256 hex digest of a Buffer.
 */
export declare function sha256Hex(buf: Buffer): string;
/**
 * Pull the fleet-pack tarball from GHCR and write it to `destDir`. Verifies
 * the blob's SHA-256 against the manifest layer digest before writing — a
 * mismatch aborts (fail closed). Returns the written tarball path.
 */
export declare function pullFleetBundleTarball(config: PullBundleConfig): Promise<string>;
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
export declare function applyMovedPaths(dest: string, manifest: FleetFileManifest): number;
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
export declare function removeTombstonedPaths(dest: string, manifest: FleetFileManifest): number;
/**
 * Prune stale fleet files so a fetch is a true SYNC (place + prune) — scoped
 * to what the bundle PREVIOUSLY owned. Only a file the last-applied manifest
 * shipped (the applied-files record, see readAppliedFiles) that the current
 * manifest no longer ships is deleted. The prune list comes from MANIFESTS,
 * never a directory walk, so repo-owned files that merely live beside the
 * fleet payload — per-repo EXPECTED variants like
 * `.config/fleet/tsconfig.check.json`, `.gitkeep` seeds, cascade-only
 * release-excluded scripts under `scripts/fleet/` — can never be collateral.
 * Excluded conditional files without a record are pruned only when their
 * bytes match the archive. Locally customized files remain untouched.
 */
interface PruneStaleFleetFilesOptions {
  archiveManifest?: FleetFileManifest | undefined;
}
export declare function pruneStaleFleetFiles(dest: string, manifest: FleetFileManifest, previousFiles: readonly string[] | undefined, options?: PruneStaleFleetFilesOptions | undefined): number;
//#endregion
//#region scripts/repo/gen/bootstrap/src/install.d.mts
export interface InstallFilesOptions {
  /**
   * Place always-tracked surfaces even when the target exists (opt-in).
   */
  refreshTracked?: boolean | undefined;
  templateDir?: string | undefined;
}
export interface InstallFilesResult {
  placed: number;
  skippedAlwaysTracked: number;
  /**
   * Always-tracked paths force-refreshed from the bundle (only under
   * --refresh-tracked).
   */
  refreshedTracked: string[];
  /**
   * Targets already holding the exact bytes, so no write happened. This runs
   * from the pnpm `prepare` lifecycle on every `pnpm run`, so a high
   * `unchanged` with `placed` near zero is the healthy steady state.
   */
  unchanged: number;
}
/**
 * Whether the target already holds the exact bytes a placement would write.
 *
 * Size first, because a differing size settles it without reading either file.
 * WHY skip at all: this runs from the pnpm `prepare` lifecycle, so it fires on
 * EVERY `pnpm run <anything>`, and an unconditional copy rewrote all ~3.5k
 * mirrors each time. That churns every mtime and leaves a window where a
 * concurrent reader sees a half-rewritten tree — measured as spurious failures
 * in tests that shell out to `git status` while a second pnpm invocation was
 * mid-prepare.
 */
export declare function hasIdenticalBytes(source: string, target: string): boolean;
export declare function installFiles(filesDir: string, dest: string, manifest: BundleManifest, options?: InstallFilesOptions | undefined): InstallFilesResult;
/**
 * Materialize the fleet mirrors in a PRODUCER checkout from its own
 * `template/base/universal`, rather than from a fetched bundle.
 *
 * The wheelhouse holds the canon locally, so it has no bundle to fetch and is
 * not a fleet-pack consumer. That is the only reason its mirrors stayed in
 * version control: nothing else could put them back. Producing the payload does
 * not require tracking the output, so this is the producer's belt.
 *
 * Why it must live in this dep-0 entry and not in the cascade: the cascade
 * cannot load without the payload it would be materializing.
 * `template/base/universal/scripts/fleet/land-work.mts` and its siblings import
 * the LIVE `.claude/hooks/fleet/_shared/**`, so a checkout whose mirrors are
 * absent dies at module resolution before any fixer runs. Same reason the
 * fetcher cannot ship inside the bundle it fetches.
 *
 * Returns undefined when `template/base/universal` is absent, which is every
 * consumer: the caller then knows this checkout is not a producer and fetches
 * instead.
 */
export declare function materializeFromLocalTemplate(dest: string, manifest: BundleManifest, options?: InstallFilesOptions | undefined): InstallFilesResult | undefined;
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
export declare function untrackGeneratedOutputs(dest: string, generatedPaths: readonly string[] | undefined): void;
/**
 * Apply each fleet-canonical segment: read the `.fleetblock` file, read the
 * consumer's existing file (or start with an empty string), splice the block
 * in, and write back.
 */
export declare function installSegments(segmentsDir: string, dest: string, manifest: BundleManifest): void;
/**
 * Merge the release's canonical Claude settings section into the consumer's
 * hybrid file. Fleet keys are replaced; repo-owned top-level settings and
 * `.claude/hooks/repo/` registrations survive. Malformed JSON fails closed.
 */
export declare function installSettingsSegment(segmentsDir: string, dest: string, manifest: BundleManifest): number;
/**
 * If the manifest includes a `workspaceSegment`, merge the fleet-managed
 * sections into the consumer's `pnpm-workspace.yaml`. Returns 0 on success,
 * 1 on any error (fail-closed).
 */
export declare function installWorkspaceSegment(segmentsDir: string, dest: string, manifest: BundleManifest): number;
export declare const SYNC_FLEET_SCRIPT = "node scripts/repo/bootstrap/fleet.mjs";
export declare const PREPARE_FETCH = "node scripts/repo/bootstrap/prepare.mts";
/**
 * The PRODUCER belt: materialize the mirrors from this checkout's own
 * `template/base/universal` instead of fetching a bundle. The wheelhouse's
 * counterpart to PREPARE_FETCH, and it runs in the same slot for the same
 * reason — the git-hooks installer it precedes is itself one of the untracked
 * mirrors.
 */
export declare const PREPARE_FROM_TEMPLATE = "node scripts/repo/bootstrap/fleet.mjs --from-template";
export declare const FLEET_STATUS_SCRIPT = "node scripts/repo/bootstrap/fleet.mjs --status";
/**
 * Wire the consumer's package.json for thin distribution: a `sync-fleet` script
 * (manual full re-fetch) and the `prepare` BELT — the idempotent auto-fetch
 * prepended so a fresh clone / CI `pnpm install` repopulates the untracked
 * fleet payload BEFORE the (itself-untracked) install-git-hooks step + any
 * chained build runs. Idempotent: skips when both are already in place. No-ops
 * if package.json is absent. (Dep-0 file — raw JSON, not EditablePackageJson.)
 */
export declare function wirePackageJson(dest: string): void;
//#endregion
//#region scripts/repo/gen/bootstrap/src/lockstep.d.mts
export type LockStepStateName = 'current' | 'out-of-sync' | 'update-available';
export interface LockStepConfig {
  readonly ref: string;
  readonly cascadeSha: string;
}
export interface LockStepInputs {
  readonly config: LockStepConfig;
  readonly pinnedTemplateSha: string | undefined;
  readonly newestTemplateSha: string | undefined;
  readonly newestRef: string | undefined;
}
export interface LockStepState {
  readonly state: LockStepStateName;
  readonly inLockStep: boolean;
  readonly updateAvailable: boolean;
  readonly config: LockStepConfig;
  readonly pinnedTemplateSha: string | undefined;
  readonly newestTemplateSha: string | undefined;
  readonly newestRef: string | undefined;
}
export interface RefValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}
/**
 * Validate a `bundle.ref` value at WRITE time. Rejects an empty, fuzzy, ranged,
 * or aliased ref — only an exact `fleet-pack-<hex>` tag is legal. Returns the
 * list of problems (empty === valid).
 */
export declare function validateRef(ref: unknown): RefValidation;
/**
 * Validate a `bundle.cascadeSha` value at WRITE time. Rejects anything that is
 * not a bare 40-char lowercase hex SHA (no `v` prefix, no range, no alias).
 */
export declare function validateCascadeSha(cascadeSha: unknown): RefValidation;
/**
 * Validate a complete `bundle` block (both fields together). Used by the
 * write-time gate in the config reader + the cascade stamper.
 */
export declare function validateBundleBlock(bundle: unknown): RefValidation;
/**
 * Resolve the lock-step state from the PARSED inputs (never a substring scan).
 * Pure — no IO — so the three states + their exit codes unit-test offline.
 *
 * - CURRENT: inLockStep AND no newer release.
 * - UPDATE-AVAILABLE: inLockStep but a newer release exists.
 * - OUT-OF-SYNC: cascadeSha !== pinnedTemplateSha (broken invariant).
 *
 * When `pinnedTemplateSha` is undefined the ref's release could not be found,
 * so the invariant cannot be confirmed and the state is OUT-OF-SYNC — fail loud
 * rather than assume current.
 */
export declare function resolveLockStepState(inputs: LockStepInputs): LockStepState;
/**
 * The terraform `-detailed-exitcode`-style exit code for a resolved state.
 * 0  CURRENT, or UPDATE-AVAILABLE without --exit-code.
 * 10 UPDATE-AVAILABLE WITH --exit-code (a clean "drift detected" signal).
 * 1  OUT-OF-SYNC — ALWAYS (broken invariant, fail loud regardless of flags).
 */
export declare function lockStepExitCode(state: LockStepState, options?: {
  exitCode?: boolean | undefined;
} | undefined): number;
export declare const ERR_LOCKSTEP_MISMATCH = "ERR_WHEELHOUSE_LOCKSTEP_MISMATCH";
export interface LockStepErrorParts {
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
export declare function formatLockStepError(parts: LockStepErrorParts): string;
export declare const UPDATE_NOTIFIER_OPT_OUT_ENV = "WHEELHOUSE_NO_UPDATE_NOTIFIER";
export interface NoticeStore {
  readonly lastCheckMs: number;
  readonly lastSeenRef: string | undefined;
}
export declare function readNoticeStore(dest: string): NoticeStore | undefined;
export declare function writeNoticeStore(dest: string, store: NoticeStore): void;
export interface NoticeDecisionInputs {
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
 * last seen. A fresh release bypasses the 24h throttle immediately.
 */
export declare function shouldShowNotice(inputs: NoticeDecisionInputs): boolean;
/**
 * Format the boxed passive notice. NAMES the re-cascade as the action (never a
 * bare re-fetch). Honors NO_COLOR by dropping the box-drawing emphasis to plain
 * ASCII when `color` is false.
 */
export declare function formatUpdateNotice(config: {
  readonly newestRef: string;
  readonly color: boolean;
}): string;
//#endregion
//#region scripts/repo/gen/bootstrap/src/resolve.d.mts
/**
 * @file Pack-ref resolution and lock-step assertion helpers.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   Dep-0 (no socket-lib): pure logic plus the anonymous GHCR reads in
 *   ghcr-fetch.mts. None do filesystem writes.
 *   Lock-step note: assertLockStep enforces the cascadeSha === templateSha
 *   invariant but does not resolve refs itself - see packTemplateSha and
 *   resolveNewestRef.
 */
/**
 * Assert the lock-step invariant before applying a release: the member's pinned
 * `bundle.cascadeSha` MUST equal the release's `templateSha`.
 * `--frozen-lockfile` semantics — a hard fail (never apply a mismatched
 * release). Returns true when intact OR when the member declares no
 * `cascadeSha` (a non-lock-step member — the legacy ref-only pin still
 * fetches). Logs the parsed error + returns false on mismatch.
 */
export declare function assertLockStep(config: {
  readonly cascadeSha: string | undefined;
  readonly manifestTemplateSha: string;
  readonly ref: string;
}): boolean;
export declare const ERR_BUNDLE_BEHIND_LOCAL = "ERR_WHEELHOUSE_BUNDLE_BEHIND_LOCAL_TEMPLATE";
/**
 * True when a sibling wheelhouse checkout exists AND its HEAD is strictly
 * DESCENDED from the bundle's template SHA — the bundle is a frozen snapshot
 * of an older template, so unpacking it would roll the member backwards.
 *
 * `assertLockStep` only proves the bundle matches its own pin, which is a
 * self-consistency check. It cannot see that the pin itself went stale. On a
 * machine that also cascades from a local template, the two writers disagree
 * and whichever runs last wins: the cascade writes current content, then
 * `update`'s bundle pass restores the older snapshot over it. That reverted a
 * Socket catalog pin, dropped fleet rules out of CLAUDE.md, and reintroduced a
 * duplicated overrides block that broke `pnpm install` — each time reported as
 * a successful update.
 *
 * Returns false when there is no local wheelhouse (a thin member, or CI),
 * where the bundle IS the only source of truth and applying it is correct.
 * Any git failure also returns false: this guard refuses a provably stale
 * bundle, and never blocks on a question it could not answer.
 *
 * That includes an UNREACHABLE pin, which is the normal state after the fleet
 * squashes its default branch. The cascade-side twin
 * (`isPinnedBundleBehindLocalTemplate` in
 * scripts/repo/commit-cascade/fleet-pack-channel.mts) reads the same state as
 * BEHIND, and the split is deliberate: there, being wrong means delivering a
 * payload that was already current, and here it means raising
 * ERR_WHEELHOUSE_BUNDLE_BEHIND_LOCAL_TEMPLATE and failing a member's install.
 * Only one of those is safe to guess at.
 */
export declare function isBundleBehindLocalTemplate(config: {
  readonly dest: string;
  readonly manifestTemplateSha: string;
}): boolean;
/**
 * Resolve the NEWEST pack ref from GHCR's moving `latest` tag.
 *
 * One anonymous call, and it has to work this way rather than by ordering a tag
 * list. Measured against the live registry: `/v2/<repo>/tags/list` returns
 * OLDEST first and pages at 100, so the first page began at the oldest tag and
 * did not contain the newest pack. A member also cannot settle it by git
 * ancestry, because its history is its own, not the wheelhouse's.
 *
 * So the publisher writes the same manifest at `latest` and stamps the template
 * SHA into `org.opencontainers.image.revision`. This reads that annotation and
 * rebuilds the ref from it.
 *
 * Returns undefined when the tag, the annotation, or the network is
 * unavailable. The caller treats that as "cannot tell", the same as the old
 * offline case, rather than as "up to date".
 */
export declare function resolveNewestRef(repo: string): Promise<string | undefined>;
/**
 * The template SHA a pack ref names, read from the ref itself.
 *
 * No network and no `gh`. The publish workflow derives the OCI tag and the
 * bundle contents from one `git rev-parse HEAD`, so the tag sha IS the template
 * sha and a fetched manifest could only restate it. That matters beyond speed:
 * the old path shelled `gh release download` against a channel the pack no
 * longer publishes to, so it now returns undefined for every new pack and
 * `fleet:status` silently loses the pinned sha.
 *
 * Returns undefined for a ref that carries no full sha, which the caller treats
 * the same as the old "asset absent" case.
 */
export declare function packTemplateSha(ref: string): string | undefined;
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
export declare function maybeShowUpdateNotice(config: {
  readonly dest: string;
  readonly updateAvailable: boolean;
  readonly newestRef: string | undefined;
}): boolean;
export declare function printStatusReport(state: LockStepState, config: {
  noHeader: boolean;
}): void;
/**
 * Stable-keyed JSON shape for `fleet:status --json`. Keys never change between
 * states so a script can read them unconditionally.
 */
export declare function statusJson(state: LockStepState): Record<string, unknown>;
//#endregion
//#region scripts/repo/gen/bootstrap/src/yaml-merge.d.mts
export interface MergeWorkspaceConfig {
  readonly bundleFleetSections: string;
  readonly consumerYaml: string;
  readonly fleetKeys: readonly string[];
}
export interface YamlKeyBlock {
  head: string[];
  key: string;
  lines: string[];
}
/**
 * Splice off a block's trailing separator run — the comment/blank lines at the
 * END of `blockLines` when the very last line is a comment. That run sits
 * directly above the NEXT top-level key, so it is that key's preamble, not
 * documentation of this block's last entry. Mutates `blockLines`; returns the
 * spliced run (empty when the block ends with content or blank lines only —
 * bare trailing blanks stay put as inter-block spacing).
 */
export declare function spliceYamlSeparatorRun(blockLines: string[]): string[];
/**
 * Parse a YAML string into an ordered list of top-level key blocks. Each
 * block's `lines` run from the key line up to (not including) the next
 * column-0 key line or EOF — except a trailing comment run directly above the
 * next key, which attaches to that FOLLOWING block as its `head`: it is a
 * separator headed for the next key (the `overrides:` preamble in a member's
 * pnpm-workspace.yaml), and leaving it as body tail makes the entry-scoped
 * merge strand it mid-block when consumer-only entries append after it.
 * Comment lines before the first key become the first block's head.
 */
export declare function parseYamlKeyBlocks(yaml: string): YamlKeyBlock[];
export interface YamlEntryChunk {
  id: string;
  lines: string[];
}
export interface YamlEntryBody {
  chunks: YamlEntryChunk[];
  trailing: string[];
}
/**
 * Split a top-level key block's BODY lines into entry chunks. A chunk starts
 * at a map-entry or list-item line at the block's entry indent; comment and
 * blank lines BEFORE an entry attach to it as documentation for the entry
 * that immediately follows; deeper-indented lines are continuations. Comments
 * and blanks after the last entry come back as `trailing`, unattached, since
 * they document nothing that a merge can key on. Returns `undefined` when the
 * body has no recognizable entries — a scalar block, nothing nested to merge.
 */
export declare function parseYamlEntryChunks(bodyLines: readonly string[]): YamlEntryBody | undefined;
/**
 * Merge one fleet-managed top-level key block ENTRY-SCOPED — the workspace
 * analog of the Claude-settings splice that keeps repo hook registrations
 * inside the fleet-owned `hooks` key. Fleet-shipped entries (present in the
 * bundle block) take the bundle's text, comments included; member-local
 * entries that appear only in the consumer block survive in their original
 * order after the fleet set. Scalar-shaped blocks (`saveExact: true`) have no
 * nested entries, so the bundle block replaces wholesale. Trailing blank lines
 * follow the consumer block so inter-block spacing is preserved. The merged
 * block's head (the separator run above its key) is the BUNDLE's when the
 * bundle ships one — canonical text, and it retires a stale consumer copy —
 * falling back to the consumer's so local spacing and comments survive when
 * the bundle has none.
 */
export declare function mergeYamlKeyBlock(bundleBlock: YamlKeyBlock, consumerBlock: YamlKeyBlock): YamlKeyBlock;
/**
 * Merge the fleet-managed workspace sections from `bundleFleetSections` into
 * `consumerYaml`, scoped to the keys listed in `fleetKeys` — and, within each
 * fleet key, scoped to the ENTRIES the bundle ships (mergeYamlKeyBlock):
 * member-local nested entries (repo-specific `catalog:`/`overrides:` pins,
 * soak-exclude items, …) survive a refresh instead of being wholesale-dropped.
 * Non-fleet keys (including `packages:`) are preserved byte-exact. Throws on
 * ambiguous input.
 */
export declare function mergeWorkspaceYaml(config: MergeWorkspaceConfig): string;
//#endregion
//#region scripts/repo/gen/bootstrap/src/fleet.d.mts
export declare function resolveRepoRoot(startDir: string): string;
export declare function parseArgs(argv: readonly string[]): InstallConfig;
/**
 * Render the `fleet:status` report. Read-only — NEVER mutates. Resolves the
 * pinned release's templateSha + the newest release, builds the lock-step
 * state, prints the table / JSON / line, and returns the terraform-style exit
 * code (0 CURRENT, 0|10 UPDATE-AVAILABLE, 1 OUT-OF-SYNC).
 */
export declare function runStatus(config: InstallConfig): Promise<number>;
/**
 * Download, verify, and apply the fleet bundle identified by `config.ref`.
 * Returns 0 on success, 1 on any error.
 */
export declare function installFleet(config: InstallConfig): Promise<number>;
export declare function isMainModule(): boolean;
//#endregion
export { OCI_MANIFEST_ACCEPT as MANIFEST_ACCEPT };