#!/usr/bin/env node
/**
 * @file Soak-aware Docker base-image update runner. Repins a Dockerfile's `FROM
 *   image:tag` to the newest tag whose registry-recorded creation time is at
 *   least `soakDays` old, pinned by digest (`image:tag@sha256:...`). Soak is a
 *   TRUST GATE: a tag younger than `soakDays` is never a repin target, and a
 *   tag whose age can't be verified is skipped (fail-closed) — the runner never
 *   pins to something it can't age-check. `soakDays` is a parameter supplied by
 *   the orchestrator, never hardcoded here. The registry dance is the standard
 *   Docker Registry v2 / OCI distribution-spec flow: an anonymous bearer-token
 *   request (Docker Hub via `auth.docker.io`, a generic registry via the
 *   `WWW-Authenticate` 401 challenge), then `GET /v2/<repo>/tags/list`, then
 *   per-tag `GET /v2/<repo>/manifests/<ref>` (reading the
 *   `Docker-Content-Digest` response header for the pin digest), then the
 *   config blob `GET /v2/<repo>/blobs/<configDigest>` for its `.created`
 *   timestamp. Manifest lists / OCI indexes are resolved to a concrete platform
 *   manifest (preferring linux/amd64) to reach a config blob, but the pinned
 *   digest stays the top-level tag digest so the pin remains multi-arch. Each
 *   HTTP step is a small named function so a test can stub it with nock. Usage:
 *   node scripts/fleet/update/docker.mts --soak-days 7 node
 *   scripts/fleet/update/docker.mts --soak-days 7 --fix.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { httpJson, httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { findOwnFiles, requireSoakDays } from './_shared.mts'
import { isUnquotedPosition } from './brew-parse.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Docker Hub's canonical registry host + the default `library/` namespace for
// official images (`node` -> `library/node`).
const DOCKER_HUB_REGISTRY = 'registry-1.docker.io'

// Media types offered on a manifest GET so the registry serves either a single
// image manifest or a multi-arch index/list (distribution-spec Accept set).
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ')

const MS_PER_DAY = 86_400_000

export interface FromRef {
  // The full original `FROM ...` line, verbatim.
  raw: string
  // The image reference as written in the Dockerfile (e.g. `node`,
  // `ghcr.io/foo/bar`), without its tag or digest — preserved for repinning so
  // the short form stays short.
  image: string
  // Resolved registry host used for API calls (e.g. `registry-1.docker.io`).
  registry: string
  // Resolved repository path (e.g. `library/node`, `foo/bar`).
  repo: string
  // The tag as written (defaults to `latest` when the source omitted one).
  tag: string
  // The pinned digest as written (`sha256:...`), or undefined when unpinned.
  digest: string | undefined
  // The `AS <stage>` name, when the source declared one.
  stage: string | undefined
}

export interface AuthChallenge {
  realm: string
  service: string | undefined
  scope: string | undefined
}

export interface ImageCreated {
  digest: string
  created: Date
}

export interface RepinPlan {
  digest: string
  newTag: string
  ref: FromRef
}

interface Semverish {
  nums: number[]
  flavor: string
}

interface ManifestBody {
  config?: { digest?: string | undefined } | undefined
  manifests?:
    | Array<{
        digest?: string | undefined
        platform?:
          | { architecture?: string | undefined; os?: string | undefined }
          | undefined
      }>
    | undefined
  mediaType?: string | undefined
}

// The Docker Hub token endpoint for an anonymous pull scope. A generic registry
// instead advertises its realm via the WWW-Authenticate 401 challenge.
export function dockerHubTokenUrl(repo: string): string {
  return `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`
}

// Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."`
// challenge into its realm/service/scope. Returns undefined for a non-Bearer or
// realm-less header.
export function parseWwwAuthenticate(
  header: string,
): AuthChallenge | undefined {
  const bearer = /^\s*Bearer\s+(.*)$/i.exec(header)
  if (!bearer) {
    return undefined
  }
  const params: Record<string, string> = { __proto__: null! }
  for (const match of bearer[1]!.matchAll(/(\w+)="([^"]*)"/g)) {
    params[match[1]!] = match[2]!
  }
  const realm = params['realm']
  if (!realm) {
    return undefined
  }
  return { realm, scope: params['scope'], service: params['service'] }
}

// Resolve `registry` + `repo` from an image reference as written. The docker CLI
// rule: the first `/`-segment is a registry host only when it contains a `.` or
// `:` or is `localhost`; otherwise the ref targets Docker Hub, and a
// single-segment official image gains the `library/` namespace.
export function resolveRegistryRepo(image: string): {
  registry: string
  repo: string
} {
  const slash = image.indexOf('/')
  const first = slash === -1 ? '' : image.slice(0, slash)
  const looksLikeHost =
    first !== '' &&
    (first.includes('.') || first.includes(':') || first === 'localhost')
  if (looksLikeHost) {
    return { registry: first, repo: image.slice(slash + 1) }
  }
  const repo = image.includes('/') ? image : `library/${image}`
  return { registry: DOCKER_HUB_REGISTRY, repo }
}

// Split an image token into its written name, tag, and digest. A trailing
// `@sha256:...` is the digest; a `:` is a tag separator only when what follows
// has no `/` (otherwise it's a registry port).
function splitImageRef(token: string): {
  name: string
  tag: string | undefined
  digest: string | undefined
} {
  let rest = token
  let digest: string | undefined
  const at = rest.indexOf('@')
  if (at !== -1) {
    digest = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }
  let tag: string | undefined
  const colon = rest.lastIndexOf(':')
  if (colon !== -1 && !rest.slice(colon + 1).includes('/')) {
    tag = rest.slice(colon + 1)
    rest = rest.slice(0, colon)
  }
  return { digest, name: rest, tag }
}

// Locate the image token in a `FROM` line's argument list — the first token
// that is not a `--flag`. Returns its index, or -1 when absent.
function imageTokenIndex(parts: readonly string[]): number {
  let idx = 0
  while (parts[idx]?.startsWith('--')) {
    idx += 1
  }
  return idx < parts.length ? idx : -1
}

// Matches a heredoc opener anywhere on a line (`<<EOF`, `<<-EOF`, `<<'EOF'`,
// `<<"EOF"`), capturing the terminator word from whichever quoting form is
// used. The lookbehind/lookahead pair requires exactly two `<` characters, so
// a here-string (`<<<`) never matches at either overlapping position — it is
// a value substitution, not a heredoc redirection. Global so every candidate
// on a line can be checked in turn (a quoted `<<` earlier on the line must not
// hide a genuine one later).
const HEREDOC_OPEN_RE = /(?<!<)<<(?!<)-?\s*(?:'([^']+)'|"([^"]+)"|(\S+))/g

// The first genuine (unquoted) heredoc opener on `line`, or undefined. `<<`
// characters that appear inside a quoted string (`echo "usage: cat <<EOF"`)
// are shell text, not a redirection, so `isUnquotedPosition` rejects any
// candidate whose `<<` sits inside an open quote before moving on to the next
// candidate on the same line.
function findHeredocOpener(line: string): string | undefined {
  HEREDOC_OPEN_RE.lastIndex = 0
  for (;;) {
    const match = HEREDOC_OPEN_RE.exec(line)
    if (!match) {
      return undefined
    }
    if (isUnquotedPosition(line.slice(0, match.index))) {
      return (match[1] ?? match[2] ?? match[3])!
    }
  }
}

// Build the set of line indices that fall inside a heredoc body (`RUN cat
// <<'EOF' > file ... EOF`), so `parseFromLines` never mistakes heredoc BODY
// text for a real `FROM` instruction. The terminator line itself is also
// skipped since it is heredoc syntax, not Dockerfile content. A candidate
// match is only treated as a genuine heredoc opener when it sits at an
// unquoted position on its line (see `findHeredocOpener`) AND its terminator
// word actually recurs on its own line somewhere later in the file; a
// bit-shift (`$((1 << 2))`), a `<<` embedded in prose, or one only found
// inside a quoted string never resolves to a genuine opener, so it is left
// unskipped and the scan resumes at the very next line instead of swallowing
// the rest of the file up to EOF.
function findHeredocBodyLines(lines: readonly string[]): Set<number> {
  const skip = new Set<number>()
  let index = 0
  while (index < lines.length) {
    const word = findHeredocOpener(lines[index]!)
    if (!word) {
      index += 1
      continue
    }
    let terminator = index + 1
    while (terminator < lines.length && lines[terminator]!.trim() !== word) {
      terminator += 1
    }
    if (terminator >= lines.length) {
      // No terminator line anywhere in the rest of the file: this was not a
      // genuine heredoc opener, so nothing is skipped for it.
      index += 1
      continue
    }
    for (let body = index + 1; body <= terminator; body += 1) {
      skip.add(body)
    }
    index = terminator + 1
  }
  return skip
}

// Parse every real image `FROM` in a Dockerfile. `FROM scratch` and a `FROM`
// that references an earlier build stage by name are skipped, as is a `FROM`
// whose image is a build-arg placeholder we can't resolve (`FROM ${BASE}`).
// A heredoc body (`RUN cat <<'EOF' > x.Dockerfile ... EOF`) is skipped
// wholesale so its contents never masquerade as a real build stage.
export function parseFromLines(dockerfile: string): FromRef[] {
  const refs: FromRef[] = []
  const stages = new Set<string>()
  const lines = dockerfile.split(/\r?\n/)
  const heredocBodyLines = findHeredocBodyLines(lines)
  for (const [index, line] of lines.entries()) {
    if (heredocBodyLines.has(index)) {
      continue
    }
    const from = /^\s*FROM\s+(.*)$/i.exec(line)
    if (!from) {
      continue
    }
    const parts = from[1]!.trim().split(/\s+/)
    const idx = imageTokenIndex(parts)
    if (idx === -1) {
      continue
    }
    const token = parts[idx]!
    let stage: string | undefined
    if (parts[idx + 1]?.toUpperCase() === 'AS' && parts[idx + 2]) {
      stage = parts[idx + 2]
    }
    const skip = token === 'scratch' || stages.has(token) || token.includes('$')
    if (skip) {
      if (stage) {
        stages.add(stage)
      }
      continue
    }
    const { digest, name, tag } = splitImageRef(token)
    const { registry, repo } = resolveRegistryRepo(name)
    refs.push({
      digest,
      image: name,
      raw: line,
      registry,
      repo,
      stage,
      tag: tag ?? 'latest',
    })
    if (stage) {
      stages.add(stage)
    }
  }
  return refs
}

// Read the first value of a possibly-array HTTP header.
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// Obtain an anonymous pull token. Docker Hub uses its known token endpoint; a
// generic registry is probed at `/v2/` for its WWW-Authenticate challenge, then
// its realm is requested with the pull scope. Fails loud when a token-requiring
// registry advertises no usable challenge.
export async function getRegistryToken(
  registry: string,
  repo: string,
): Promise<string> {
  let tokenUrl: string
  if (registry === DOCKER_HUB_REGISTRY || registry === 'docker.io') {
    tokenUrl = dockerHubTokenUrl(repo)
  } else {
    const probe = await httpRequest(`https://${registry}/v2/`)
    const header = firstHeader(probe.headers['www-authenticate'])
    const challenge = header ? parseWwwAuthenticate(header) : undefined
    if (!challenge) {
      throw new Error(
        `Cannot authenticate to registry.\n` +
          `  Where: https://${registry}/v2/ for repo ${repo}\n` +
          `  Saw: no parseable Bearer WWW-Authenticate challenge\n` +
          `  Fix: confirm the registry speaks the OCI distribution token flow.`,
      )
    }
    const params = new URLSearchParams()
    if (challenge.service) {
      params.set('service', challenge.service)
    }
    params.set('scope', `repository:${repo}:pull`)
    tokenUrl = `${challenge.realm}?${params.toString()}`
  }
  const data = await httpJson<{
    access_token?: string | undefined
    token?: string | undefined
  }>(tokenUrl, { headers: { accept: 'application/json' } })
  return data.token ?? data.access_token ?? ''
}

// GET `/v2/<repo>/tags/list`. Returns the advertised tags (empty when none).
export async function listTags(
  registry: string,
  repo: string,
  token: string,
): Promise<string[]> {
  const data = await httpJson<{ tags?: string[] | undefined }>(
    `https://${registry}/v2/${repo}/tags/list`,
    {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    },
  )
  return data.tags ?? []
}

// GET one manifest by ref (tag or digest). Returns the `Docker-Content-Digest`
// response header (the canonical content digest for the pin) plus the parsed
// manifest body.
async function fetchManifest(
  registry: string,
  repo: string,
  ref: string,
  token: string,
): Promise<{ body: ManifestBody; digest: string }> {
  const res = await httpRequest(
    `https://${registry}/v2/${repo}/manifests/${ref}`,
    { headers: { accept: MANIFEST_ACCEPT, authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    throw new Error(
      `Manifest fetch failed.\n` +
        `  Where: /v2/${repo}/manifests/${ref} on ${registry}\n` +
        `  Saw: HTTP ${res.status}\n` +
        `  Fix: confirm the tag exists and the pull token is valid.`,
    )
  }
  const digest = firstHeader(res.headers['docker-content-digest']) ?? ''
  return { body: res.json<ManifestBody>(), digest }
}

// True when a manifest body is a multi-arch index / list rather than a single
// image manifest.
function isManifestIndex(body: ManifestBody): boolean {
  return Array.isArray(body.manifests) && body.manifests.length > 0
}

// Choose a concrete platform manifest digest from an index, preferring
// linux/amd64, then any real (non-`unknown`) platform, then the first entry.
function pickPlatformManifestDigest(body: ManifestBody): string | undefined {
  const entries = body.manifests ?? []
  const amd64 = entries.find(
    m => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64',
  )
  const real = entries.find(m => m.platform?.os && m.platform.os !== 'unknown')
  return (amd64 ?? real ?? entries[0])?.digest
}

// Resolve the pin digest + creation time for an image ref. The pinned digest is
// the top-level tag digest (multi-arch-safe); `.created` comes from the config
// blob of a concrete platform image (resolved through the index when needed).
export async function imageCreatedTime(
  registry: string,
  repo: string,
  ref: string,
  token: string,
): Promise<ImageCreated> {
  const top = await fetchManifest(registry, repo, ref, token)
  let configDigest = top.body.config?.digest
  if (isManifestIndex(top.body)) {
    const platformDigest = pickPlatformManifestDigest(top.body)
    if (!platformDigest) {
      throw new Error(
        `Manifest index had no platform entry.\n` +
          `  Where: /v2/${repo}/manifests/${ref} on ${registry}\n` +
          `  Saw: empty manifests[]\n` +
          `  Fix: confirm the tag publishes at least one platform.`,
      )
    }
    const sub = await fetchManifest(registry, repo, platformDigest, token)
    configDigest = sub.body.config?.digest
  }
  if (!configDigest) {
    throw new Error(
      `Manifest carried no config digest.\n` +
        `  Where: /v2/${repo}/manifests/${ref} on ${registry}\n` +
        `  Saw: missing config.digest\n` +
        `  Fix: expected an OCI/Docker v2 image manifest with a config blob.`,
    )
  }
  const config = await httpJson<{ created?: string | undefined }>(
    `https://${registry}/v2/${repo}/blobs/${configDigest}`,
    {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    },
  )
  return { created: new Date(config.created ?? 0), digest: top.digest }
}

// Parse a semver-ish tag into its numeric components + non-numeric flavor
// suffix (`26.5-alpine` -> nums [26,5], flavor `-alpine`). Returns undefined for
// a tag with no leading numeric version (`latest`, `stable`). Hand-scanned (no
// regex) so the version-prefix walk can't backtrack.
function parseSemverish(tag: string): Semverish | undefined {
  const start = tag.startsWith('v') ? 1 : 0
  let end = start
  while (end < tag.length) {
    const ch = tag[end]!
    if (ch >= '0' && ch <= '9') {
      end += 1
    } else if (ch === '.' && end > start && tag[end - 1] !== '.') {
      end += 1
    } else {
      break
    }
  }
  // A trailing dot belongs to the flavor, not the version.
  if (tag[end - 1] === '.') {
    end -= 1
  }
  if (end === start || tag[start] === '.') {
    return undefined
  }
  const nums = tag
    .slice(start, end)
    .split('.')
    .map(part => Number(part))
  return { flavor: tag.slice(end), nums }
}

// Order two semver-ish tags: numeric components first (higher wins), then a
// bare flavor outranks a suffixed one, then lexical flavor. Positive when `a` is
// the higher (newer) tag.
function compareSemverish(a: Semverish, b: Semverish): number {
  const len = Math.max(a.nums.length, b.nums.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  if (a.flavor === b.flavor) {
    return 0
  }
  if (a.flavor === '') {
    return 1
  }
  if (b.flavor === '') {
    return -1
  }
  return a.flavor < b.flavor ? 1 : -1
}

// Pick the highest semver-ish tag that has cleared the soak window. A tag is
// eligible only when its recorded creation time is at least `soakDays` old — the
// trust gate. `latest`, non-semver tags, and any tag with no verifiable creation
// time are skipped (fail-closed). Tags are only ranked within their own flavor
// group. Returns undefined when nothing clears soak.
export function newestSoakClearedTag(
  tags: readonly string[],
  createdByTag: Record<string, Date>,
  soakDays: number,
  now: Date,
): string | undefined {
  const soakMs = soakDays * MS_PER_DAY
  const nowMs = now.getTime()
  let best: string | undefined
  let bestParsed: Semverish | undefined
  for (const tag of tags) {
    if (tag === 'latest') {
      continue
    }
    const parsed = parseSemverish(tag)
    if (!parsed) {
      continue
    }
    const created = createdByTag[tag]
    // No verifiable age -> cannot clear the trust gate.
    if (!created) {
      continue
    }
    if (nowMs - created.getTime() < soakMs) {
      continue
    }
    if (!best || compareSemverish(parsed, bestParsed!) > 0) {
      best = tag
      bestParsed = parsed
    }
  }
  return best
}

// Rewrite a `FROM` line to pin `image:<newTag>@sha256:<digest>`, preserving the
// written image name, any `--flag`, and the `AS <stage>` clause. `digest` may be
// a bare hex or a full `sha256:...`.
export function repinFrom(
  line: string,
  newTag: string,
  digest: string,
): string {
  const canonical = digest.startsWith('sha256:') ? digest : `sha256:${digest}`
  const from = /^(\s*FROM\s+)(.*)$/i.exec(line)
  if (!from) {
    return line
  }
  const parts = from[2]!.trim().split(/\s+/)
  const idx = imageTokenIndex(parts)
  if (idx === -1) {
    return line
  }
  const { name } = splitImageRef(parts[idx]!)
  parts[idx] = `${name}:${newTag}@${canonical}`
  return `${from[1]}${parts.join(' ')}`
}

// Test whether a filename is a Dockerfile (`Dockerfile`, `Dockerfile.<suffix>`,
// or `<name>.Dockerfile`).
function isDockerfileName(name: string): boolean {
  return (
    name === 'Dockerfile' ||
    name.startsWith('Dockerfile.') ||
    name.toLowerCase().endsWith('.dockerfile')
  )
}

// Find every Dockerfile under `root` that this repo owns, skipping vendored /
// generated subtrees (see `findOwnFiles`). Returns normalized absolute paths,
// sorted.
export function findOwnDockerfiles(root: string): string[] {
  return findOwnFiles(root, isDockerfileName)
}

// Resolve the soak-cleared repin for one `FROM` ref, or undefined when the
// newest soak-cleared tag is the one already pinned. Only considers tags in the
// same flavor group and strictly newer than the current version, so an older or
// same tag never triggers a repin.
export async function planRepinForRef(
  ref: FromRef,
  soakDays: number,
  now: Date,
): Promise<RepinPlan | undefined> {
  const token = await getRegistryToken(ref.registry, ref.repo)
  const tags = await listTags(ref.registry, ref.repo, token)
  const current = parseSemverish(ref.tag)
  const candidates = tags.filter(tag => {
    if (tag === 'latest') {
      return false
    }
    const parsed = parseSemverish(tag)
    if (!parsed) {
      return false
    }
    if (current) {
      if (parsed.flavor !== current.flavor) {
        return false
      }
      return compareSemverish(parsed, current) > 0
    }
    return true
  })
  const createdByTag: Record<string, Date> = { __proto__: null! }
  const digestByTag: Record<string, string> = { __proto__: null! }
  for (const tag of candidates) {
    const info = await imageCreatedTime(ref.registry, ref.repo, tag, token)
    createdByTag[tag] = info.created
    digestByTag[tag] = info.digest
  }
  const winner = newestSoakClearedTag(candidates, createdByTag, soakDays, now)
  if (!winner) {
    return undefined
  }
  // Nothing to do when the winner is already the pinned tag+digest.
  if (winner === ref.tag && ref.digest === digestByTag[winner]) {
    return undefined
  }
  return { digest: digestByTag[winner]!, newTag: winner, ref }
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const fix = argv.includes('--fix')
  const soakDays = requireSoakDays(argv, 'update-docker')
  const root = flagValue(argv, '--root') ?? REPO_ROOT
  const now = new Date()
  const dockerfiles = findOwnDockerfiles(root)
  let planned = 0
  for (const file of dockerfiles) {
    const text = readFileSync(file, 'utf8')
    let next = text
    for (const ref of parseFromLines(text)) {
      const plan = await planRepinForRef(ref, soakDays, now)
      if (!plan) {
        continue
      }
      planned += 1
      const repinned = repinFrom(ref.raw, plan.newTag, plan.digest)
      next = next.replace(ref.raw, repinned)
      const where = path.relative(root, file)
      logger.info(
        `[update-docker] ${where}: ${ref.image}:${ref.tag} -> ${ref.image}:${plan.newTag}@${plan.digest} (soak ${soakDays}d cleared)`,
      )
    }
    if (fix && next !== text) {
      writeFileSync(file, next)
    }
  }
  if (planned === 0) {
    logger.info('[update-docker] no soak-cleared base-image updates found.')
  } else if (!fix) {
    logger.info(
      `[update-docker] ${planned} repin(s) planned; re-run with --fix to write.`,
    )
  } else {
    logger.success(`[update-docker] wrote ${planned} repin(s).`)
  }
}

if (isMainModule(import.meta.url)) {
  void (async (): Promise<void> => {
    await main()
  })()
}
