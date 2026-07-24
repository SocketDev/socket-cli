#!/usr/bin/env node
// Claude Code PreToolUse hook — latest-release-pin-guard.
//
// BLOCKS an Edit/Write to `.gitmodules` or a `*lockstep.json` manifest that
// SETS or CHANGES an upstream pin to something OLDER than the newest shipped
// release tag. Porting an upstream means the LATEST release — always. A pin left
// at a stale/inherited release is a work-loss trap: the opentui incident pinned
// v0.1.99, 211 commits and 3 minor releases behind v0.4.5, and ~31k lines were
// ported against it before anyone noticed.
//
// What it checks, per changed pin:
//   - `.gitmodules`    — a `[submodule "…"]` block's `ref`/`branch` pin.
//   - `*lockstep.json` — a version-pin row's `pinned_sha`/`pinned_tag`; the
//     upstream repo URL is resolved from the manifest's `upstreams` map.
// It fetches the upstream's tags with `git ls-remote --tags <url>`, finds the
// newest STABLE tag sharing the pin's version scheme, and blocks when the pin
// resolves to an older one — naming the newer release. Only pins that are NEW or
// whose value CHANGED in this edit are checked: the post-edit text via
// `resolveEditedText` is diffed against the on-disk file, so touching an
// unrelated field never false-blocks a pin already committed.
//
// Fails OPEN on anything it can't determine — an offline `ls-remote`, an
// unparseable tag scheme, a sha that maps to no release tag, a fragment edit
// whose post-edit text can't be reconstructed. The CI-side lockstep drift check
// (`scripts/fleet/lockstep/checks.mts`) is the online backstop.
//
// Convention: docs/agents.md/fleet/lockstep.md + docs/agents.md/fleet/drift-watch.md.
// Bypass: `Allow latest-release-pin bypass`.

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'

export const triggers: readonly string[] = ['.gitmodules', 'lockstep']

// A pin file lives at `.gitmodules` or a lockstep manifest — `lockstep.json`,
// `.config/repo/lockstep.json` (or legacy `.config/lockstep.json`), or a
// `lockstep-<area>.json` include. The emitted
// `lockstep.schema.json` is not a manifest, so the `.schema.json` tail excludes
// it.
const GITMODULES_RE = /(?:^|\/)\.gitmodules$/
// `(?:^|/)` path boundary, `lockstep`, an optional `-<area>` suffix, then a
// literal `.json` at end — matches the manifests above but not `.schema.json`.
const LOCKSTEP_RE = /(?:^|\/)lockstep(?:-[a-z0-9-]+)?\.json$/

export function isGitmodulesFile(filePath: string): boolean {
  return GITMODULES_RE.test(normalizePath(filePath))
}

export function isLockstepFile(filePath: string): boolean {
  return LOCKSTEP_RE.test(normalizePath(filePath))
}

export function isPinFile(filePath: string): boolean {
  return isGitmodulesFile(filePath) || isLockstepFile(filePath)
}

// ---------------------------------------------------------------------------
// Version-tag math. Mirrors the tag resolver in
// `scripts/fleet/lockstep/auto-bump.mts` — the hook can't import across the
// bundle boundary, so the small parse/compare core is duplicated here and
// tested alongside it.
// ---------------------------------------------------------------------------

export interface TagVersion {
  major: number
  minor: number
  patch: number
}

export interface ParsedTag {
  prefix: string
  version: TagVersion
}

// Pre-release / nightly suffixes: a stale STABLE pin is the hazard, so
// pre-releases are never a "newer release" to bump toward.
const PRERELEASE_RE =
  /-(?:alpha|beta|dev|nightly|preview|rc|snapshot)(?:[._-]?\d+)?$/iu

export function isStableTag(tag: string): boolean {
  return !PRERELEASE_RE.test(tag)
}

// Parse `v1.2.3`, `1.2.3`, `<prefix>-1.2.3`, `<prefix>_1_2_3` into
// { prefix, version }; two-component forms take patch 0. `undefined` when no
// semver triple is present, so an exotic tag never proposes a bump.
export function parseVersionTag(tag: string): ParsedTag | undefined {
  // Underscore scheme (`<prefix>_1_2_3`): digits joined by underscores.
  const underscore = /^(.*?)[._-]?(\d+)_(\d+)(?:_(\d+))?$/u.exec(tag)
  if (underscore && tag.includes('_')) {
    return {
      prefix: underscore[1]!.replace(/[._-]$/u, ''),
      version: {
        major: Number(underscore[2]),
        minor: Number(underscore[3]),
        patch: Number(underscore[4] ?? 0),
      },
    }
  }
  // Dotted scheme, optionally `v`- or `<prefix>-` prefixed.
  const dotted = /^(.*?)(\d+)\.(\d+)(?:\.(\d+))?$/u.exec(tag)
  if (dotted) {
    return {
      prefix: dotted[1]!.replace(/[._-]$/u, '').replace(/^v$/u, ''),
      version: {
        major: Number(dotted[2]),
        minor: Number(dotted[3]),
        patch: Number(dotted[4] ?? 0),
      },
    }
  }
  return undefined
}

export function compareTagVersions(a: TagVersion, b: TagVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor
  }
  return a.patch - b.patch
}

// The newest STABLE tag sharing `pinTag`'s scheme prefix, iff it is strictly
// newer than `pinTag`. Constrained to the pin's prefix so a `v`-scheme pin never
// "upgrades" onto a `<prefix>-` tag from another epoch. `undefined` when the pin
// is already newest, its scheme is unparseable, or no candidate shares it.
export function newerReleaseThan(
  pinTag: string,
  tagNames: readonly string[],
): string | undefined {
  const current = parseVersionTag(pinTag)
  if (!current) {
    return undefined
  }
  let best: { raw: string; version: TagVersion } | undefined
  for (let i = 0, { length } = tagNames; i < length; i += 1) {
    const name = tagNames[i]!
    if (!isStableTag(name)) {
      continue
    }
    const parsed = parseVersionTag(name)
    if (!parsed || parsed.prefix !== current.prefix) {
      continue
    }
    if (!best || compareTagVersions(parsed.version, best.version) > 0) {
      best = { raw: name, version: parsed.version }
    }
  }
  if (best && compareTagVersions(best.version, current.version) > 0) {
    return best.raw
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Pin parsing + evaluation.
// ---------------------------------------------------------------------------

export interface RemoteTag {
  name: string
  sha: string
}

export type ListTags = (url: string) => readonly RemoteTag[]

export interface GitmodulesPin {
  name: string
  url: string | undefined
  ref: string | undefined
  branch: string | undefined
}

export interface LockstepPin {
  id: string
  upstream: string
  repo: string | undefined
  pinnedSha: string | undefined
  pinnedTag: string | undefined
}

export interface PinViolation {
  name: string
  pinned: string
  newest: string
}

// Parse `.gitmodules` blocks: a `[submodule "<name>"]` header opens a block; the
// fleet's `url`, `ref` pinned commit, and `branch` pinned tag are captured.
export function parseGitmodulesPins(content: string): GitmodulesPin[] {
  const pins: GitmodulesPin[] = []
  let current: GitmodulesPin | undefined
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    const header = /^\[submodule\s+"([^"]+)"\]$/.exec(line)
    if (header) {
      current = {
        name: header[1]!,
        url: undefined,
        ref: undefined,
        branch: undefined,
      }
      pins.push(current)
      continue
    }
    if (!current) {
      continue
    }
    // `key = value` inside a block.
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.+)$/.exec(line)
    if (!kv) {
      continue
    }
    const key = kv[1]!.toLowerCase()
    const value = kv[2]!.trim()
    if (key === 'branch') {
      current.branch = value
    } else if (key === 'ref') {
      current.ref = value
    } else if (key === 'url') {
      current.url = value
    }
  }
  return pins
}

// Parse a lockstep manifest's version-pin rows, resolving each row's repo URL
// from the top-level `upstreams` map. `resolveEditedText` hands us the full
// post-edit JSON, so an Edit fragment still parses as a complete document.
export function parseLockstepPins(content: string): LockstepPin[] {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object') {
    return []
  }
  const obj = doc as {
    upstreams?: unknown | undefined
    rows?: unknown | undefined
  }
  const upstreams =
    obj.upstreams && typeof obj.upstreams === 'object'
      ? (obj.upstreams as Record<string, { repo?: unknown | undefined }>)
      : {}
  const rows = Array.isArray(obj.rows) ? obj.rows : []
  const pins: LockstepPin[] = []
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i] as {
      kind?: unknown | undefined
      id?: unknown | undefined
      upstream?: unknown | undefined
      pinned_sha?: unknown | undefined
      pinned_tag?: unknown | undefined
    }
    if (!row || row.kind !== 'version-pin') {
      continue
    }
    const upstream = typeof row.upstream === 'string' ? row.upstream : ''
    const up = upstreams[upstream]
    pins.push({
      id: typeof row.id === 'string' ? row.id : '',
      pinnedSha:
        typeof row.pinned_sha === 'string' ? row.pinned_sha : undefined,
      pinnedTag:
        typeof row.pinned_tag === 'string' ? row.pinned_tag : undefined,
      repo: up && typeof up.repo === 'string' ? up.repo : undefined,
      upstream,
    })
  }
  return pins
}

// Parse `git ls-remote --tags` output into { name, sha } pairs. Peeled entries
// (`refs/tags/x^{}`) are kept as their own pair with the `^{}` stripped, so a
// sha-only pin at an annotated tag's COMMIT still resolves to the tag name.
export function parseLsRemote(out: string): RemoteTag[] {
  const tags: RemoteTag[] = []
  const lines = out.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // `<sha>` hex 7-40, whitespace, `refs/tags/`, then the captured tag name.
    const m = /^([0-9a-f]{7,40})\s+refs\/tags\/(.+)$/.exec(lines[i]!.trim())
    if (m) {
      tags.push({ name: m[2]!.replace(/\^\{\}$/, ''), sha: m[1]! })
    }
  }
  return tags
}

// The tag name a pinned sha resolves to, matching full or shared-prefix shas.
function tagForSha(
  sha: string,
  tags: readonly RemoteTag[],
): string | undefined {
  if (!sha) {
    return undefined
  }
  for (let i = 0, { length } = tags; i < length; i += 1) {
    const t = tags[i]!
    if (t.sha === sha || (sha.length >= 7 && t.sha.startsWith(sha))) {
      return t.name
    }
  }
  return undefined
}

// The release tag a pin currently resolves to: its explicit tag when set, else
// the tag its sha points at.
function pinnedReleaseTag(
  explicitTag: string | undefined,
  sha: string | undefined,
  tags: readonly RemoteTag[],
): string | undefined {
  if (explicitTag) {
    return explicitTag
  }
  return sha ? tagForSha(sha, tags) : undefined
}

export function evaluateGitmodules(
  before: string,
  after: string,
  listTags: ListTags,
): PinViolation[] {
  const beforeByName = new Map(
    parseGitmodulesPins(before).map(p => [p.name, p]),
  )
  const violations: PinViolation[] = []
  const pins = parseGitmodulesPins(after)
  for (let i = 0, { length } = pins; i < length; i += 1) {
    const pin = pins[i]!
    const prev = beforeByName.get(pin.name)
    const changed = !prev || prev.ref !== pin.ref || prev.branch !== pin.branch
    if (!changed || !pin.url) {
      continue
    }
    const tags = listTags(pin.url)
    if (!tags.length) {
      continue
    }
    const pinTag = pinnedReleaseTag(pin.branch, pin.ref, tags)
    if (!pinTag) {
      continue
    }
    const newest = newerReleaseThan(
      pinTag,
      tags.map(t => t.name),
    )
    if (newest) {
      violations.push({ name: pin.name, newest, pinned: pinTag })
    }
  }
  return violations
}

export function evaluateLockstep(
  before: string,
  after: string,
  listTags: ListTags,
): PinViolation[] {
  const beforeById = new Map(parseLockstepPins(before).map(p => [p.id, p]))
  const violations: PinViolation[] = []
  const pins = parseLockstepPins(after)
  for (let i = 0, { length } = pins; i < length; i += 1) {
    const pin = pins[i]!
    if (!pin.repo) {
      continue
    }
    const prev = beforeById.get(pin.id)
    const changed =
      !prev ||
      prev.pinnedSha !== pin.pinnedSha ||
      prev.pinnedTag !== pin.pinnedTag
    if (!changed) {
      continue
    }
    const tags = listTags(pin.repo)
    if (!tags.length) {
      continue
    }
    const pinTag = pinnedReleaseTag(pin.pinnedTag, pin.pinnedSha, tags)
    if (!pinTag) {
      continue
    }
    const newest = newerReleaseThan(
      pinTag,
      tags.map(t => t.name),
    )
    if (newest) {
      violations.push({ name: pin.upstream, newest, pinned: pinTag })
    }
  }
  return violations
}

export function formatBlock(violations: readonly PinViolation[]): string {
  const lines: string[] = [
    `[latest-release-pin-guard] Blocked: a pin is being set to a STALE release, not the newest.`,
    '',
  ]
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    lines.push(
      `  ${v.name}: pinned at ${v.pinned}, but ${v.newest} has shipped.`,
    )
  }
  lines.push('')
  lines.push(
    '  Porting an upstream means the LATEST shipped release — always. Pinning a',
  )
  lines.push(
    '  stale or inherited release ports against code that is already behind; the',
  )
  lines.push(
    '  opentui incident lost ~31k lines to a pin 3 minor releases old.',
  )
  lines.push('')
  lines.push('  Fix: `git fetch --tags`, then pin the newest release above —')
  lines.push(
    '  `gen/gitmodules-hash.mts --set` for .gitmodules, the version-pin row for',
  )
  lines.push('  lockstep.json. See docs/agents.md/fleet/lockstep.md and')
  lines.push('  docs/agents.md/fleet/drift-watch.md.')
  return lines.join('\n') + '\n'
}

// The real tag lister: query the remote directly, so a not-yet-cloned submodule
// still resolves. NETWORK spawn — a fixed timeout, never platform-scaled (see
// _shared/spawn-timeout.mts). Any failure returns [] and the guard fails open.
function listRemoteTags(url: string): RemoteTag[] {
  try {
    const result = spawnSync('git', ['ls-remote', '--tags', url], {
      stdio: ['ignore', 'pipe', 'ignore'],
      stdioString: true,
      timeout: 15_000,
    })
    if (result.status !== 0 || typeof result.stdout !== 'string') {
      return []
    }
    return parseLsRemote(result.stdout)
  } catch {
    return []
  }
}

export const check = editGuard((filePath, _content, payload) => {
  if (!isPinFile(filePath) || !isFleetTarget(payload)) {
    return undefined
  }
  const after = resolveEditedText(payload)
  if (after === undefined) {
    return undefined
  }
  const before = safeReadFileSync(filePath) ?? ''
  const violations = isGitmodulesFile(filePath)
    ? evaluateGitmodules(before, after, listRemoteTags)
    : evaluateLockstep(before, after, listRemoteTags)
  if (!violations.length) {
    return undefined
  }
  return block(formatBlock(violations))
})

export const hook = defineHook({
  bypass: ['latest-release-pin'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
