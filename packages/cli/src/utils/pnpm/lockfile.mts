import fs from 'node:fs'

import yaml from 'js-yaml'
import semver from 'semver'

import { readFileUtf8 } from '@socketsecurity/lib/fs'
import { isObjectObject } from '@socketsecurity/lib/objects'
import { stripBom } from '@socketsecurity/lib/strings'

import { idToNpmPurl } from '../ecosystem/spec.mjs'

import type { LockfileObject, PackageSnapshot } from '@pnpm/lockfile.fs'
import type { SemVer } from 'semver'

export function extractOverridesFromPnpmLockSrc(lockfileContent: any): string {
  let match: any
  if (typeof lockfileContent === 'string') {
    // Use non-greedy match to prevent catastrophic backtracking from nested quantifiers.
    match = /^overrides:(?:\r?\n {2}[^\n]+)*(?:\r?\n)*/m.exec(
      lockfileContent,
    )?.[0]
  }
  return match ?? ''
}

export async function extractPurlsFromPnpmLockfile(
  lockfile: LockfileObject,
): Promise<string[]> {
  const packages = lockfile?.packages ?? {}
  const seen = new Set<string>()
  const visit = (pkgPath: string) => {
    if (seen.has(pkgPath)) {
      return
    }
    const pkg = (packages as any)[pkgPath] as PackageSnapshot
    if (!pkg) {
      return
    }
    seen.add(pkgPath)
    const deps: { [name: string]: string } = {
      __proto__: null,
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...(pkg as any).devDependencies,
    }
    for (const depName in deps) {
      const ref = deps[depName]
      if (!ref) {
        continue
      }
      const subKey = isPnpmDepPath(ref) ? ref : `/${depName}@${ref}`
      visit(subKey)
    }
  }
  for (const pkgPath of Object.keys(packages)) {
    visit(pkgPath)
  }
  return Array.from(seen).map(p =>
    idToNpmPurl(stripPnpmPeerSuffix(stripLeadingPnpmDepPathSlash(p))),
  )
}

export function isPnpmDepPath(maybeDepPath: string): boolean {
  return maybeDepPath.length > 0 && maybeDepPath.charCodeAt(0) === 47 /*'/'*/
}

export function parsePnpmLockfile(
  lockfileContent: unknown,
): LockfileObject | null {
  let result: any
  if (typeof lockfileContent === 'string') {
    try {
      result = yaml.load(stripBom(lockfileContent))
    } catch {}
  }
  return isObjectObject(result)
    ? ({ lockfileVersion: '', importers: {}, ...result } as LockfileObject)
    : null
}

export function parsePnpmLockfileVersion(version: unknown): SemVer | undefined {
  try {
    return semver.coerce(version as string) ?? undefined
  } catch {}
  return undefined
}

export async function readPnpmLockfile(
  lockfilePath: string,
): Promise<string | undefined> {
  return fs.existsSync(lockfilePath)
    ? await readFileUtf8(lockfilePath)
    : undefined
}

export function stripLeadingPnpmDepPathSlash(depPath: string): string {
  return isPnpmDepPath(depPath) ? depPath.slice(1) : depPath
}

/**
 * Strip pnpm peer dependency suffix from a dep path or bare version.
 *
 * pnpm appends peer dependency info in one of two shapes:
 * - `(peer@2.0.0)` — parentheses (pnpm v7+).
 * - `_peer@2.0.0`  — underscore (pnpm v6 / older lockfiles).
 *
 * The suffix can appear either attached to a full dep path
 * (`http_ece@1.2.0_web-push@3.6.7`) or to a bare version fragment
 * (`4.18.0_peer@1.0.0`, passed from `resolvePackageVersion` in
 * spec.mts). Either way, the separator always sits *after* the
 * version.
 *
 * Naive `indexOf('_')` is wrong for dep paths because package names
 * may legitimately contain `_` (e.g. `http_ece`). Searching strictly
 * after the first `@` is wrong for bare-version inputs because the
 * only `@` they carry is the one inside the peer suffix itself
 * (`peer@1.0.0`), so "after the first `@`" lands past the separator.
 *
 * Approach:
 *   1. Find the earliest `_` / `(` in the whole string.
 *   2. If the first `@` comes before that separator, we have a
 *      `name@version...` dep path — the separator is a real peer
 *      suffix and we cut there. (The `@` came from the version,
 *      not from a peer suffix embedded earlier.)
 *   3. If there is no `@` before the separator (bare version), the
 *      separator itself marks the peer suffix and we cut there too.
 *   4. If there's no separator at all, return unchanged.
 *
 * Semver forbids `(` and `_` in a version / prerelease / build
 * tag, so any `_` or `(` before an eventual version-`@` must be
 * inside the package name — never a peer separator. That's the
 * only case where we have to ignore the earliest separator, and it
 * only applies when the input starts with a name.
 *
 * This previously scanned the whole string for `_` / `(` unguarded,
 * which truncated `http_ece@1.0.0` to `http` and produced a
 * blocking false-positive alert against npm's `http@0.0.1-security`
 * malware placeholder.
 */
export function stripPnpmPeerSuffix(depPath: string): string {
  // Defensive: handle empty or invalid inputs.
  if (!depPath || typeof depPath !== 'string') {
    return depPath
  }

  // Disambiguate `name@version...` dep paths from bare version
  // fragments (`4.18.0_peer@1.0.0`, passed by resolvePackageVersion)
  // by looking at the first character. npm package names cannot
  // start with a digit, and semver versions always do — so a
  // leading digit means this is a bare version and the earliest
  // `(` / `_` is the peer-suffix cut.
  const firstChar = depPath.charCodeAt(0)
  const startsWithDigit = firstChar >= 48 /*'0'*/ && firstChar <= 57 /*'9'*/
  if (startsWithDigit) {
    const parenIdx = depPath.indexOf('(')
    const underIdx = depPath.indexOf('_')
    let sepIdx: number
    if (parenIdx === -1) {
      sepIdx = underIdx
    } else if (underIdx === -1) {
      sepIdx = parenIdx
    } else {
      sepIdx = Math.min(parenIdx, underIdx)
    }
    return sepIdx === -1 ? depPath : depPath.slice(0, sepIdx)
  }

  // `name@version...` dep path. The peer-suffix separator is always
  // *after* the version-separating `@`. Package names may contain
  // `_` (e.g. `http_ece`) so we must not scan the name region.
  // A leading `@` is a scope marker, not a version separator.
  const scopeOffset = depPath.startsWith('@') ? 1 : 0
  const versionAt = depPath.indexOf('@', scopeOffset)
  if (versionAt === -1) {
    return depPath
  }

  const tail = depPath.slice(versionAt)
  const parenInTail = tail.indexOf('(')
  const underInTail = tail.indexOf('_')
  let cutInTail: number
  if (parenInTail === -1) {
    cutInTail = underInTail
  } else if (underInTail === -1) {
    cutInTail = parenInTail
  } else {
    // Both present — take whichever comes first (handles the
    // `(peer)_legacyPeer` shape in mixed-format lockfiles).
    cutInTail = Math.min(parenInTail, underInTail)
  }
  return cutInTail === -1 ? depPath : depPath.slice(0, versionAt + cutInTail)
}
