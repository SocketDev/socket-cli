#!/usr/bin/env node
// Claude Code PreToolUse hook — release-tag-tied-guard.
//
// A GitHub release is always tied to a git tag. This hook ALLOWS
// `gh release create <ref> …` only when `<ref>` is an EXISTING pushed (or
// local) tag — the legitimate backfill case (`gh release create v0.0.18
// --verify-tag …`). It BLOCKS when the tag does not exist (gh would create
// it on the fly = an arbitrary, un-reviewed tag) or when `--target` is
// present (gh would create the tag from that branch/sha).
//
// Why gate it instead of denying outright: the fleet's settings.json moves
// `Bash(gh release create:*)` from `deny` to `allow` so tag-backfills run
// without a prompt; this hook is the safety rail that keeps "allow" from
// meaning "create any release at any ref".
//
// Tag existence is checked two ways (either is sufficient):
//   - local:  `git rev-parse --verify --quiet refs/tags/<ref>`
//   - remote: `git ls-remote --tags origin <ref>` returns a ref line
//
// PUBLISH-BEFORE-RELEASE gate (the v6.2.0 near-miss: an immutable release cut
// before a stage-publish that then failed on auth — a release with no
// artifact): even for an existing tag, when the repo publishes to a registry
// (a non-private package.json, else a Cargo.toml [package]) and the ref names
// a version, the release may only be cut once that version is LIVE on its
// registry (`npm view` / crates.io sparse index). The pipeline cuts the tag +
// release itself (publish-pipeline.mts --approve, via a child spawn this hook
// never sees) — an agent-run `gh release create` is by definition outside it,
// so it must stand on a confirmed publish. Registry-less repos and non-semver
// refs skip the gate. Unverifiable liveness (network error, missing tool)
// BLOCKS — an irreversible-release guard errs strict; the bypass phrase
// covers genuine exceptions.
//
// Bypass: `Allow arbitrary-release bypass` typed verbatim in a recent turn.
//
// Fails open on parse / payload / git errors (exit 0) — a guard bug must not
// wedge every release command. (The registry-liveness probe is the deliberate
// exception: not-verifiable blocks.)

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

import type { GuardCheck } from '../_shared/guard.mts'

// `gh release create` flags that consume the FOLLOWING token as their value.
// Skipping their values keeps the positional <tag> scan from mistaking a
// flag value (e.g. `--title v1.2.3`) for the release ref.
const VALUE_FLAGS = new Set([
  '--discussion-category',
  '--notes',
  '--notes-file',
  '--notes-start-tag',
  '--repo',
  '--target',
  '--title',
  '-F',
  '-n',
  '-R',
  '-t',
])

// Pre-flight gate for the dispatcher: this guard can only ever block a
// `gh release create …` invocation, whose detection requires the literal
// `release` token adjacent to `create`. A command without `release` can never
// reach a block, so the dispatcher skips importing this guard for it.
export const triggers: readonly string[] = ['release']

export interface ReleaseCreateDetection {
  readonly detected: boolean
  // The release ref (first positional after `create`); '' when none was found.
  readonly ref: string
  // True when `--target <commitish>` is present (gh would create the tag).
  readonly hasTarget: boolean
}

const NOT_DETECTED: ReleaseCreateDetection = {
  detected: false,
  hasTarget: false,
  ref: '',
}

// Find a real `gh release create …` invocation and pull out its ref + whether
// `--target` is set. Parser-based (commandsFor), so a quoted "gh release
// create" inside another command's string isn't a false trigger.
export function detectReleaseCreate(command: string): ReleaseCreateDetection {
  for (const { args } of commandsFor(command, 'gh')) {
    const createIdx = args.indexOf('create')
    if (
      createIdx < 1 ||
      args[createIdx - 1] !== 'release' ||
      args.indexOf('release') !== createIdx - 1
    ) {
      continue
    }
    let ref = ''
    let hasTarget = false
    for (let i = createIdx + 1, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg === '--target' || arg.startsWith('--target=')) {
        hasTarget = true
      }
      if (arg.startsWith('-')) {
        // A value-taking flag in `--flag value` form swallows the next token.
        if (VALUE_FLAGS.has(arg) && !arg.includes('=')) {
          i += 1
        }
        continue
      }
      if (!ref) {
        ref = arg
      }
    }
    return { detected: true, hasTarget, ref }
  }
  return NOT_DETECTED
}

// True when `<ref>` resolves to an existing tag — local first, then remote.
export function tagExists(ref: string, cwd: string): boolean {
  if (!ref) {
    return false
  }
  const local = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${ref}`],
    { cwd, stdio: 'pipe' },
  )
  if (!local.error && local.status === 0) {
    return true
  }
  const remote = spawnSync('git', ['ls-remote', '--tags', 'origin', ref], {
    cwd,
    stdio: 'pipe',
  })
  /* c8 ignore next - remote exits 0 with empty stdout only in live-network git; in-process tests always see exit 128 (no auth) */
  return !remote.error && remote.status === 0 && !!String(remote.stdout).trim()
}

export function formatBlock(d: ReleaseCreateDetection): string {
  const reason = d.hasTarget
    ? `\`--target\` is set, so \`gh release create\` would CREATE the tag${d.ref ? ` \`${d.ref}\`` : ''} from that commitish.`
    : d.ref
      ? `tag \`${d.ref}\` does not exist locally or on origin, so \`gh release create\` would create it on the fly.`
      : 'no release ref was given, so the tag it would create cannot be verified.'
  return (
    [
      `[release-tag-tied-guard] Blocked: ${reason}`,
      '',
      '  A GitHub release must be tied to an EXISTING tag. Push the tag first,',
      '  then create the release for it:',
      '',
      '    git tag vX.Y.Z <commit> && git push origin vX.Y.Z',
      '    gh release create vX.Y.Z --verify-tag …',
    ].join('\n') + '\n'
  )
}

// ── publish-before-release gate ─────────────────────────────────────────────

// A semver-ish release ref: `v1.2.3`, `1.2.3`, `v1.2.3-beta.4`.
const RELEASE_REF_VERSION_RE = /^v?(?<version>\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/

/**
 * The version a release ref names, or undefined for non-semver refs (those
 * skip the liveness gate — the guard can't tell what registry entry they map
 * to).
 */
export function versionFromReleaseRef(ref: string): string | undefined {
  return RELEASE_REF_VERSION_RE.exec(ref)?.groups?.['version']
}

/**
 * The registry subject this repo publishes: its non-private package.json name
 * (npm), else its Cargo.toml `[package]` name (crates.io), else undefined for
 * registry-less (github-release-only / private) repos.
 */
export function detectRegistrySubject(
  cwd: string,
): { name: string; registry: 'npm' | 'crates.io' } | undefined {
  try {
    const pkgPath = path.join(cwd, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        name?: unknown | undefined
        private?: unknown | undefined
      }
      if (typeof pkg.name === 'string' && pkg.name && pkg.private !== true) {
        return { name: pkg.name, registry: 'npm' }
      }
    }
    const cargoPath = path.join(cwd, 'Cargo.toml')
    if (existsSync(cargoPath)) {
      const cargo = readFileSync(cargoPath, 'utf8')
      // The [package] name; a [workspace]-only manifest has none and skips.
      const name = /^\s*name\s*=\s*"(?<name>[^"]+)"/m.exec(cargo)?.groups?.[
        'name'
      ]
      if (name) {
        return { name, registry: 'crates.io' }
      }
    }
  } catch {
    // Unreadable manifests: no registry subject — the gate skips.
  }
  return undefined
}

// The crates.io sparse-index path for a crate name (the same scheme the
// github-release.yml gate uses): 1 → `1/<n>`, 2 → `2/<n>`,
// 3 → `3/<first>/<n>`, else `<first2>/<next2>/<n>`.
export function cratesIndexPath(name: string): string {
  const n = name.toLowerCase()
  if (n.length === 1) {
    return `1/${n}`
  }
  if (n.length === 2) {
    return `2/${n}`
  }
  if (n.length === 3) {
    return `3/${n[0]}/${n}`
  }
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`
}

// Injectable registry probes so tests never hit the network. Both return true
// ONLY on a confirmed-live version; errors and misses are both "not live".
export interface RegistryProbes {
  crateVersionLive?: ((name: string, version: string) => boolean) | undefined
  npmVersionLive?:
    | ((name: string, version: string, cwd: string) => boolean)
    | undefined
}

function defaultNpmVersionLive(
  name: string,
  version: string,
  cwd: string,
): boolean {
  const view = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    cwd,
    stdio: 'pipe',
  })
  return !view.error && view.status === 0 && !!String(view.stdout).trim()
}

function defaultCrateVersionLive(name: string, version: string): boolean {
  const fetch = spawnSync(
    'curl',
    ['-fsS', `https://index.crates.io/${cratesIndexPath(name)}`],
    { stdio: 'pipe' },
  )
  return (
    !fetch.error &&
    fetch.status === 0 &&
    String(fetch.stdout).includes(`"vers":"${version}"`)
  )
}

/**
 * The publish-before-release gate: for a repo with a registry subject and a
 * semver release ref, require the version to be LIVE on that registry before
 * any `gh release create`. Returns the block message, or undefined to allow.
 */
export function publishBeforeReleaseGate(
  ref: string,
  cwd: string,
  probes?: RegistryProbes | undefined,
): string | undefined {
  const p = { __proto__: null, ...probes } as RegistryProbes
  const version = versionFromReleaseRef(ref)
  if (!version) {
    return undefined
  }
  const subject = detectRegistrySubject(cwd)
  if (!subject) {
    return undefined
  }
  const live =
    subject.registry === 'npm'
      ? (p.npmVersionLive ?? defaultNpmVersionLive)(subject.name, version, cwd)
      : (p.crateVersionLive ?? defaultCrateVersionLive)(subject.name, version)
  if (live) {
    return undefined
  }
  return (
    [
      `[release-tag-tied-guard] Blocked: ${subject.name}@${version} is not live on ${subject.registry} — the GH release may only follow the registry publish.`,
      '',
      '  ORDER RULE: the tag + immutable GH release are the FINAL markers of a',
      '  release. A STAGED package is not published (staging may never be',
      '  approved) — cutting the release first can mark a version that never',
      '  shipped. Publish through the pipeline; it cuts the tag + release LAST,',
      '  behind a registry-liveness gate:',
      '',
      '    node scripts/fleet/publish-pipeline.mts --approve   # npm: promote → tag + GH release',
      '    node scripts/fleet/cargo-publish.mts --approve      # crates.io: publish → tag + GH release',
      '',
      '  If the version really is live and the probe failed (offline?), the',
      '  user re-runs the probe or the command themselves.',
    ].join('\n') + '\n'
  )
}

/**
 * Build the guard check. `probes` is a test seam for the registry-liveness
 * gate (the exported `check` uses the real npm/crates probes).
 */
export function makeCheck(probes?: RegistryProbes | undefined): GuardCheck {
  return bashGuard((command, payload) => {
    const detection = detectReleaseCreate(command)
    if (!detection.detected) {
      return undefined
    }

    const cwd = resolveProjectDir(
      typeof payload.cwd === 'string' ? payload.cwd : undefined,
    )
    if (!detection.hasTarget && tagExists(detection.ref, cwd)) {
      // Existing tag, no --target: the legitimate backfill shape — allowed
      // only once the tagged version is live on the repo's registry
      // (publish-before-release order).
      const orderBlock = publishBeforeReleaseGate(detection.ref, cwd, probes)
      return orderBlock === undefined ? undefined : block(orderBlock)
    }

    return block(formatBlock(detection))
  })
}

export const check = makeCheck()

export const hook = defineHook({
  bypass: ['arbitrary-release'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
