/**
 * @file Has a fleet member ever shipped a PUBLISHED artifact? One probe, two
 *   consumers: the `fresh-members-are-squashed-until-release` gate and the
 *   roster WRITER (`scripts/repo/register-fleet-member.mts`), which defaults a
 *   brand-new member into the `squash-history` opt-in only while it is still
 *   unreleased.
 *   AUTHORITATIVE SIGNALS: npm and crates.io. A registry version is what a
 *   consumer's lockfile resolves and what npm provenance binds to a source
 *   commit, so it is the moment after which rewriting history breaks somebody.
 *   GitHub releases are deliberately not a signal: socket-wheelhouse carries
 *   20+ release bundles and squashes its own default branch by design, so a
 *   release asset on its own does not close the squash window.
 *   RESERVATION CARVE-OUT: a registry `latest` of PLACEHOLDER_VERSION is a name
 *   claim published by `publish-infra/{npm,cargo}/placeholder.mts` to bootstrap
 *   OIDC trusted publishing, not a release. Nothing resolves it, so it leaves
 *   the window open.
 *   NETWORK DISCIPLINE: every failure mode — no `gh`, no auth, an API error, a
 *   registry timeout — yields `unverified` carrying the reason. The probe never
 *   reports `unreleased` for a member it could not read.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOCKET_GITHUB_ORGS } from '../constants/socket-scopes.mts'
import { resolveCrateReleaseSha } from '../crate-release-sha.mts'
import { PLACEHOLDER_VERSION } from '../publish-infra/cargo/placeholder.mts'
import { fetchPublishedVersionChecked } from '../publish-infra/cargo/registry.mts'
import {
  fetchLatestGitHead,
  fetchLatestPublishedVersionChecked,
} from '../publish-infra/npm/registry.mts'

// The org a roster entry belongs to when it declares no `owner`.
const HOME_ORG = SOCKET_GITHUB_ORGS[0]!

// The workspace directories a multi-package fleet repo keeps its publishables
// in. A root manifest plus this one level is the layout every fleet member
// uses; a member's root manifest is frequently `private: true` with the real
// artifacts one level down.
const CRATES_DIR = 'crates'
const PACKAGES_DIR = 'packages'

// How many workspace manifests one directory may contribute. A registry-scale
// monorepo has hundreds of package directories, and probing each would turn one
// member into a thousand API calls. Past the cap the member reads UNVERIFIED —
// bounded and honest, never a guess.
const MAX_WORKSPACE_MANIFESTS = 25

// `gh` spells a missing path three ways depending on how the failure surfaces:
// the JSON error body, the HTTP status line, or the plain-text message.
// Alternations sorted.
const GH_NOT_FOUND_RE = /"status":\s*"404"|HTTP 404|Not Found/

// A TOML table header — `[package]`, `[dependencies]`, and the array-of-tables
// form `[[bin]]`. The doubled brackets matter: `[[bin]]` carries its own `name`
// key, so a parser that does not recognize it as a new table reads the binary's
// name as the crate's.
const TOML_TABLE_RE = /^\s*\[\[?([^\][]+)\]\]?\s*$/

// A bare `key = "value"` string assignment. A dotted key (`name.workspace`)
// deliberately does not match: an inherited name is resolved by cargo, not
// readable from the member manifest alone.
const TOML_STRING_RE = /^\s*([A-Za-z_-]+)\s*=\s*"([^"]*)"/

// `publish = false` — the crate opts out of every registry, so it can never
// close a squash window.
const TOML_PUBLISH_FALSE_RE = /^\s*publish\s*=\s*false\s*$/

export type ReleaseVerdict = 'released' | 'unreleased' | 'unverified'

export type ArtifactRegistry = 'crates.io' | 'npm'

/**
 * One member's release state. `unverified` carries the reason so a skip is
 * never silent — an operator can tell "npm says never published" from "there
 * was no GitHub token". `anchorSha` — the source commit the registry recorded
 * for the released version (npm `gitHead`, crates.io `.cargo_vcs_info.json`
 * `git.sha1`) — is set only on a `released` verdict, and only when the
 * registry actually recorded one; the frozen-zone-reachability check treats a
 * missing anchor the same as an unreachable one: unverified, never a false
 * hazard.
 */
export interface MemberReleaseState {
  readonly anchorSha?: string | undefined
  readonly artifact?: string | undefined
  readonly reason?: string | undefined
  readonly registry?: ArtifactRegistry | undefined
  readonly verdict: ReleaseVerdict
  readonly version?: string | undefined
}

/**
 * The roster fields this probe needs to address a member on GitHub.
 */
export interface MemberRepoRef {
  readonly name: string
  readonly owner?: string | undefined
}

/**
 * One remote file read: `found` with text, `absent` when the repo has no such
 * path, or `error` when the read itself could not be completed.
 */
export interface MemberFileRead {
  readonly reason?: string | undefined
  readonly status: 'absent' | 'error' | 'found'
  readonly text?: string | undefined
}

/**
 * One remote directory listing, with the same three-state contract as
 * `MemberFileRead`.
 */
export interface MemberDirRead {
  readonly names: readonly string[]
  readonly reason?: string | undefined
  readonly status: 'absent' | 'error' | 'found'
}

/**
 * `<owner>/<name>` for a roster entry, defaulting a missing owner to the home
 * org — the same defaulting every other member-wide fleet check applies.
 */
export function memberRepoSlug(member: MemberRepoRef): string {
  return `${member.owner ?? HOME_ORG}/${member.name}`
}

// The first non-empty line of a multi-line tool error, so a reason reads as one
// sentence rather than a wall of gh output.
function firstLine(text: string): string {
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line !== '') {
      return line
    }
  }
  return 'no output'
}

// Run `gh api <args>`, folding a 404 into its own state. The lib `spawn`
// rejects on a non-zero exit carrying stdout/stderr, which is where gh writes
// the error body.
async function ghApi(args: readonly string[]): Promise<{
  notFound: boolean
  ok: boolean
  reason?: string | undefined
  stdout: string
}> {
  try {
    const r = (await spawn('gh', ['api', ...args], {
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return { notFound: false, ok: true, stdout: String(r?.stdout ?? '') }
  } catch (e) {
    const err = e as {
      stderr?: string | undefined
      stdout?: string | undefined
    }
    const text = `${err?.stdout ?? ''}${err?.stderr ?? ''}${errorMessage(e)}`
    if (GH_NOT_FOUND_RE.test(text)) {
      return { notFound: true, ok: false, stdout: '' }
    }
    return { notFound: false, ok: false, reason: firstLine(text), stdout: '' }
  }
}

export type FrozenZoneReachability = 'orphaned' | 'reachable' | 'unverified'

/**
 * Whether a member's frozen release anchor (`anchorSha`) is still reachable
 * from its default branch — the remote (GH-API-only, no clone) equivalent of
 * `git merge-base --is-ancestor <anchorSha> HEAD`. Uses GitHub's compare API:
 * comparing `<defaultBranch>...<anchorSha>` reports `identical`/`behind` when
 * the anchor IS an ancestor of the default branch (the frozen zone is
 * intact), and `ahead`/`diverged` when it is NOT (the socket-mcp orphan
 * shape — the anchor sits off the branch's lineage, e.g. after a full-root
 * squash that should have frozen it). Any read failure — no default branch,
 * an unreadable compare, a 404 on the anchor itself — is `unverified`, never
 * `orphaned`: this check runs on the CI/release tier, not interactively, but
 * it still must never turn a network hiccup into a false hazard.
 */
export async function verifyFrozenZoneReachable(
  member: MemberRepoRef,
  anchorSha: string,
): Promise<FrozenZoneReachability> {
  const slug = memberRepoSlug(member)
  const repoRead = await ghApi([`repos/${slug}`, '--jq', '.default_branch'])
  const defaultBranch = repoRead.stdout.trim()
  if (!repoRead.ok || !defaultBranch) {
    return 'unverified'
  }
  const compareRead = await ghApi([
    `repos/${slug}/compare/${defaultBranch}...${anchorSha}`,
    '--jq',
    '.status',
  ])
  const status = compareRead.stdout.trim()
  if (!compareRead.ok || !status) {
    return 'unverified'
  }
  return status === 'behind' || status === 'identical'
    ? 'reachable'
    : 'orphaned'
}

/**
 * Read one file from a member's default branch through the GitHub contents
 * API. A private member reads fine, because the caller's token carries the
 * access. A 404 means the member genuinely has no such manifest.
 */
export async function readMemberRepoFile(
  member: MemberRepoRef,
  filePath: string,
): Promise<MemberFileRead> {
  const slug = memberRepoSlug(member)
  const result = await ghApi([
    `repos/${slug}/contents/${filePath}`,
    '--jq',
    '.content',
  ])
  if (result.notFound) {
    return { status: 'absent' }
  }
  if (!result.ok) {
    return {
      reason: `could not read ${slug}/${filePath}: ${result.reason ?? 'unknown error'}`,
      status: 'error',
    }
  }
  const encoded = result.stdout.replace(/\s+/g, '')
  if (encoded === '') {
    return {
      reason: `${slug}/${filePath} returned no content`,
      status: 'error',
    }
  }
  return {
    status: 'found',
    text: Buffer.from(encoded, 'base64').toString('utf8'),
  }
}

/**
 * List the subdirectory names of one directory in a member's default branch.
 */
export async function listMemberRepoDirs(
  member: MemberRepoRef,
  dirPath: string,
): Promise<MemberDirRead> {
  const slug = memberRepoSlug(member)
  const result = await ghApi([
    `repos/${slug}/contents/${dirPath}`,
    '--jq',
    '.[] | select(.type == "dir") | .name',
  ])
  if (result.notFound) {
    return { names: [], status: 'absent' }
  }
  if (!result.ok) {
    return {
      names: [],
      reason: `could not list ${slug}/${dirPath}: ${result.reason ?? 'unknown error'}`,
      status: 'error',
    }
  }
  const names = result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  return { names, status: 'found' }
}

/**
 * The publishable npm package name declared by a package.json, or undefined
 * when the manifest is private, nameless, or unparseable. A `private: true`
 * workspace never reaches the registry, so it can never close a squash window.
 */
export function npmPackageNameFromManifest(text: string): string | undefined {
  let parsed: { name?: unknown | undefined; private?: unknown | undefined }
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    return undefined
  }
  if (parsed.private === true) {
    return undefined
  }
  const { name } = parsed
  return typeof name === 'string' && name !== '' ? name : undefined
}

/**
 * The publishable crate name declared by one Cargo.toml, as a list so callers
 * can concatenate a workspace. Empty for a virtual workspace manifest (no
 * `[package]` table), for an inherited `name.workspace` name, and for a crate
 * that sets `publish = false`.
 */
export function crateNamesFromCargoManifest(text: string): string[] {
  const lines = text.split('\n')
  let inPackage = false
  let publishable = true
  let name: string | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const table = TOML_TABLE_RE.exec(line)
    if (table) {
      inPackage = table[1]!.trim() === 'package'
      continue
    }
    if (!inPackage) {
      continue
    }
    if (TOML_PUBLISH_FALSE_RE.test(line)) {
      publishable = false
      continue
    }
    const assignment = TOML_STRING_RE.exec(line)
    if (assignment && assignment[1] === 'name') {
      name = assignment[2]
    }
  }
  return publishable && name !== undefined && name !== '' ? [name] : []
}

/**
 * Whether a registry `latest` is a real release. The reservation version is a
 * name claim, not a release.
 */
export function isReleasedVersion(version: string | undefined): boolean {
  return version !== undefined && version !== PLACEHOLDER_VERSION
}

/**
 * Probe one npm package name. On a `released` verdict, also resolves the
 * registry-recorded `gitHead` as `anchorSha` (fail-open: a `gitHead` read
 * failure leaves `anchorSha` unset rather than downgrading the verdict —
 * the caller treats a missing anchor as unverifiable reachability, never a
 * false hazard).
 */
export async function probeNpmArtifactRelease(
  name: string,
): Promise<MemberReleaseState> {
  const read = await fetchLatestPublishedVersionChecked(name)
  if (!read.reachable) {
    return {
      artifact: name,
      reason: `the npm registry could not be consulted for ${name}`,
      registry: 'npm',
      verdict: 'unverified',
    }
  }
  const { latest } = read
  if (!isReleasedVersion(latest)) {
    return {
      artifact: name,
      registry: 'npm',
      verdict: 'unreleased',
      version: latest,
    }
  }
  let anchorSha: string | undefined
  try {
    const gitHead = await fetchLatestGitHead(name)
    anchorSha = gitHead.reachable ? gitHead.sha : undefined
  } catch {
    anchorSha = undefined
  }
  return {
    anchorSha,
    artifact: name,
    registry: 'npm',
    verdict: 'released',
    version: latest,
  }
}

/**
 * Probe one crates.io crate name. On a `released` verdict, also resolves the
 * `.cargo_vcs_info.json` `git.sha1` as `anchorSha` (same fail-open contract as
 * the npm probe above).
 */
export async function probeCrateArtifactRelease(
  name: string,
): Promise<MemberReleaseState> {
  const read = await fetchPublishedVersionChecked(name)
  if (!read.reachable) {
    return {
      artifact: name,
      reason: `crates.io could not be consulted for ${name}`,
      registry: 'crates.io',
      verdict: 'unverified',
    }
  }
  const { latest } = read
  if (!isReleasedVersion(latest)) {
    return {
      artifact: name,
      registry: 'crates.io',
      verdict: 'unreleased',
      version: latest,
    }
  }
  let anchorSha: string | undefined
  try {
    const info = await resolveCrateReleaseSha(name)
    anchorSha = info?.sha
  } catch {
    anchorSha = undefined
  }
  return {
    anchorSha,
    artifact: name,
    registry: 'crates.io',
    verdict: 'released',
    version: latest,
  }
}

// The verdict for a member whose manifests named nothing publishable at all.
// Its root manifest is private and neither workspace directory declared an
// artifact, so where it publishes — if it publishes — is somewhere this probe
// does not look. Saying "never released" there would be a guess.
const NO_ARTIFACT_REASON =
  'no publishable npm package or crate was named by its root, packages/*, or crates/* manifests'

/**
 * Fold every artifact probe for one member into a single verdict. A released
 * artifact wins outright; otherwise an unverified probe wins over an unreleased
 * one, so a partially-readable member never reads as "confirmed never
 * released". No probes at all is UNVERIFIED, not unreleased.
 */
export function combineReleaseStates(
  states: readonly MemberReleaseState[],
): MemberReleaseState {
  for (let i = 0, { length } = states; i < length; i += 1) {
    if (states[i]!.verdict === 'released') {
      return states[i]!
    }
  }
  for (let i = 0, { length } = states; i < length; i += 1) {
    if (states[i]!.verdict === 'unverified') {
      return states[i]!
    }
  }
  return states.length === 0
    ? { reason: NO_ARTIFACT_REASON, verdict: 'unverified' }
    : { verdict: 'unreleased' }
}

// Every `<dir>/*/<manifestName>` text a member declares. An unreadable entry
// records an unverified state rather than vanishing, and a directory wider than
// the cap contributes one unverified state instead of a thousand API calls.
async function readWorkspaceManifests(
  member: MemberRepoRef,
  dir: string,
  manifestName: string,
  states: MemberReleaseState[],
): Promise<string[]> {
  const listing = await listMemberRepoDirs(member, dir)
  if (listing.status === 'error') {
    states.push({ reason: listing.reason, verdict: 'unverified' })
    return []
  }
  const { names } = listing
  if (names.length > MAX_WORKSPACE_MANIFESTS) {
    states.push({
      reason: `${memberRepoSlug(member)}/${dir} holds ${names.length} entries, past the ${MAX_WORKSPACE_MANIFESTS}-manifest probe cap`,
      verdict: 'unverified',
    })
    return []
  }
  const texts: string[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const manifest = await readMemberRepoFile(
      member,
      `${dir}/${names[i]!}/${manifestName}`,
    )
    if (manifest.status === 'error') {
      states.push({ reason: manifest.reason, verdict: 'unverified' })
      continue
    }
    if (manifest.status === 'found') {
      texts.push(manifest.text!)
    }
  }
  return texts
}

// Every manifest text for one packaging surface: the root manifest, then the
// workspace directory one level down.
async function readManifestSurface(
  member: MemberRepoRef,
  rootName: string,
  workspaceDir: string,
  states: MemberReleaseState[],
): Promise<string[]> {
  const texts: string[] = []
  const root = await readMemberRepoFile(member, rootName)
  if (root.status === 'error') {
    states.push({ reason: root.reason, verdict: 'unverified' })
  } else if (root.status === 'found') {
    texts.push(root.text!)
  }
  const workspace = await readWorkspaceManifests(
    member,
    workspaceDir,
    rootName,
    states,
  )
  for (let i = 0, { length } = workspace; i < length; i += 1) {
    texts.push(workspace[i]!)
  }
  return texts
}

// Probe the member's npm surface, short-circuiting on the first published
// package.
async function probeNpmSurface(
  member: MemberRepoRef,
  states: MemberReleaseState[],
): Promise<MemberReleaseState | undefined> {
  const texts = await readManifestSurface(
    member,
    'package.json',
    PACKAGES_DIR,
    states,
  )
  for (let i = 0, { length } = texts; i < length; i += 1) {
    const name = npmPackageNameFromManifest(texts[i]!)
    if (name === undefined) {
      continue
    }
    const state = await probeNpmArtifactRelease(name)
    if (state.verdict === 'released') {
      return state
    }
    states.push(state)
  }
  return undefined
}

// Probe the member's crates.io surface, short-circuiting on the first published
// crate.
async function probeCargoSurface(
  member: MemberRepoRef,
  states: MemberReleaseState[],
): Promise<MemberReleaseState | undefined> {
  const texts = await readManifestSurface(
    member,
    'Cargo.toml',
    CRATES_DIR,
    states,
  )
  for (let i = 0, { length } = texts; i < length; i += 1) {
    const names = crateNamesFromCargoManifest(texts[i]!)
    for (let j = 0, count = names.length; j < count; j += 1) {
      const state = await probeCrateArtifactRelease(names[j]!)
      if (state.verdict === 'released') {
        return state
      }
      states.push(state)
    }
  }
  return undefined
}

/**
 * Has this member ever published an npm package or a crate? Reads the member's
 * manifests off its default branch — root plus one workspace level, for both
 * packaging surfaces — then probes each declared artifact, stopping at the
 * first published one.
 */
export async function probeMemberRelease(
  member: MemberRepoRef,
): Promise<MemberReleaseState> {
  const states: MemberReleaseState[] = []
  const npmReleased = await probeNpmSurface(member, states)
  if (npmReleased) {
    return npmReleased
  }
  const cargoReleased = await probeCargoSurface(member, states)
  if (cargoReleased) {
    return cargoReleased
  }
  return combineReleaseStates(states)
}
