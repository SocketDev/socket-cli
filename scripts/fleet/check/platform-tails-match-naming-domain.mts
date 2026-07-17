#!/usr/bin/env node
/*
 * @file Commit-time naming-domain gate — the code-as-law surface for fleet
 *   dot-naming (ratified 2026-07-04 as the binary-vs-napi split; generalized
 *   2026-07-13 to the dotted `.lang`/`.target` scheme):
 *
 *     @<owner>/<name>[.<lang>].<target>[-<platform>]
 *
 *   The domain is read from the `.target` token in the name:
 *   - `.node` — native NAPI addon (payload `<name>.node`). Platform tail follows
 *     napi-rs naming: `platform-arch[-abi]`, `-gnu`/`-musl`/`-msvc` explicit,
 *     darwin bare (`linux-x64-gnu`, `win32-x64-msvc`). Set: napi-targets.mts.
 *   - `.wasm` — portable WebAssembly. No platform tail; one artifact everywhere.
 *   - `.exe` — standalone executable (payload at `bin/`). Platform tail follows
 *     pnpm pack-app naming: `<os>-<arch>[-musl]`, glibc unsuffixed, no toolchain
 *     segment (`linux-x64`, `win32-arm64`). Set: pack-app-triplets.mts. Exemplar:
 *     `@pnpm/exe.<os>-<arch>[-musl]`.
 *
 *   A per-platform tail whose target token, platform tail, and payload shape
 *   disagree makes the artifact kind illegible and breaks the loaders/allowlists
 *   that parse names by domain. The scan classifies each tail by its target
 *   token (payload as a cross-check) and validates the platform tail against
 *   that target's canonical set, plus os/cpu engine-field consistency.
 *
 *   Legacy (hyphen-only, no dot) names — the pre-dot-naming tail packages still
 *   in the tree — keep the payload-derived classification: a `bin` field is the
 *   `exe`/pack-app domain, a `.node` payload is the napi domain.
 *
 *   The `.lang` segment (rs/cpp/go/ts) is accepted positionally but NOT
 *   strict-checked: a segment before the target is ambiguous with a dotted base
 *   name (`acorn.foo.node-x` — is `foo` a bad lang, or part of the name?), and a
 *   false positive would block a legitimate publish. Tail-grammar + payload
 *   agreement is the enforceable surface.
 *
 *   See docs/agents.md/fleet/binary-vs-napi-naming.md for the doctrine.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  isNapiTarget,
  napiTargetEngineFields,
  parseNapiTargetSegment,
} from '../util/napi-targets.mts'
import type { NapiNativeTarget } from '../util/napi-targets.mts'
import {
  isPackAppTriplet,
  parseTripletSegment,
  tripletEngineFields,
} from '../util/pack-app-triplets.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

/**
 * Dotted target tokens, ASCII order. The presence of one (as a dot-delimited
 * segment) in a package name marks it a dot-named per-platform tail.
 */
export const DOT_TARGETS = ['exe', 'node', 'wasm'] as const

export type DotTarget = (typeof DOT_TARGETS)[number]

export interface DomainFinding {
  readonly fix: string
  readonly relPath: string
  readonly saw: string
}

export interface DottedTail {
  readonly target: DotTarget
  /**
   * The platform tail after the target token, `''` when the target carries no
   * platform (a `.wasm` artifact, or a base/family package like `@pnpm/exe`).
   */
  readonly tail: string
}

interface EngineFields {
  readonly os: readonly string[]
  readonly cpu: readonly string[]
}

interface ManifestShape {
  bin?: unknown | undefined
  cpu?: unknown | undefined
  files?: unknown | undefined
  libc?: unknown | undefined
  main?: unknown | undefined
  name?: unknown | undefined
  os?: unknown | undefined
  private?: unknown | undefined
}

/**
 * Walk `packages/` for package.json manifests (skipping node_modules and dot
 * dirs). Repos without a packages/ tree contribute nothing — the check
 * no-ops.
 */
export function collectManifestPaths(repoRoot: string): string[] {
  const results: string[] = []
  const root = path.join(repoRoot, 'packages')
  if (!existsSync(root)) {
    return results
  }
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    // Dirent types (no stat call): a dangling symlink under packages/ (a
    // stale build-output link) would crash a follow-the-link statSync with
    // ENOENT; dirents classify it as a symlink and it falls through both
    // branches harmlessly.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'upstream' ||
        entry.name.startsWith('.')
      ) {
        continue
      }
      if (entry.isDirectory()) {
        stack.push(path.join(dir, entry.name))
      } else if (entry.name === 'package.json' && entry.isFile()) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  return results
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.filter(v => typeof v === 'string')
  }
  if (value && typeof value === 'object') {
    return Object.values(value).filter(v => typeof v === 'string') as string[]
  }
  return []
}

/**
 * Classify a manifest into a naming domain by its payload shape.
 * `bin` field → 'cli'; a `.node` payload in main/files → 'napi';
 * anything else → undefined (not a platform tail, out of scope).
 */
export function classifyDomain(m: ManifestShape): 'cli' | 'napi' | undefined {
  if (m.bin !== undefined && stringsOf(m.bin).length > 0) {
    return 'cli'
  }
  const payloadRefs = [...stringsOf(m.main), ...stringsOf(m.files)]
  if (payloadRefs.some(p => p.endsWith('.node'))) {
    return 'napi'
  }
  return undefined
}

/**
 * Parse the dotted target segment + platform tail out of an unscoped package
 * name. Returns undefined when the name carries no dot (a legacy hyphen-only
 * tail, classified by payload) or has no target segment (a family/meta package
 * like `acorn.rs`). Handles both separators before the platform tail: napi-rs
 * emits `node-<napi-tail>` (hyphen), pack-app follows `exe.<triplet>` (dot).
 */
export function parseDottedTarget(
  unscopedName: string,
): DottedTail | undefined {
  if (!unscopedName.includes('.')) {
    return undefined
  }
  const segments = unscopedName.split('.')
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const seg = segments[i]!
    const rest = segments.slice(i + 1).join('.')
    for (let j = 0, tl = DOT_TARGETS.length; j < tl; j += 1) {
      const target = DOT_TARGETS[j]!
      if (seg === target) {
        return { tail: rest, target }
      }
      if (seg.startsWith(`${target}-`)) {
        const inSeg = seg.slice(target.length + 1)
        return { tail: rest ? `${inSeg}.${rest}` : inSeg, target }
      }
    }
  }
  return undefined
}

function fieldMatches(actual: unknown, expected: readonly string[]): boolean {
  const got = stringsOf(actual)
  return got.length === expected.length && expected.every(e => got.includes(e))
}

function pushEngineFindings(
  findings: DomainFinding[],
  relPath: string,
  m: ManifestShape,
  want: EngineFields,
  label: string,
): void {
  if (m.os !== undefined && !fieldMatches(m.os, want.os)) {
    findings.push({
      fix: `set "os": ${JSON.stringify(want.os)}`,
      relPath,
      saw: `os field ${JSON.stringify(stringsOf(m.os))} disagrees with ${label}`,
    })
  }
  if (m.cpu !== undefined && !fieldMatches(m.cpu, want.cpu)) {
    findings.push({
      fix: `set "cpu": ${JSON.stringify(want.cpu)}`,
      relPath,
      saw: `cpu field ${JSON.stringify(stringsOf(m.cpu))} disagrees with ${label}`,
    })
  }
}

/**
 * Validate a dot-named per-platform tail (target read from the name). The
 * platform tail must match the target's canonical grammar and the payload must
 * agree with the target.
 */
function checkDottedTail(
  relPath: string,
  m: ManifestShape,
  name: string,
  dotted: DottedTail,
): DomainFinding[] {
  const { tail, target } = dotted
  const findings: DomainFinding[] = []
  const payloadDomain = classifyDomain(m)

  if (target === 'wasm') {
    if (tail !== '') {
      findings.push({
        fix: 'drop the platform tail; a .wasm artifact is platformless',
        relPath,
        saw: `.wasm target "${name}" carries a platform tail "${tail}"; wasm runs everywhere`,
      })
    }
    if (payloadDomain === 'cli') {
      findings.push({
        fix: 'ship the wasm binary, not a bin/ executable',
        relPath,
        saw: `.wasm target "${name}" ships a bin payload`,
      })
    } else if (payloadDomain === 'napi') {
      findings.push({
        fix: 'ship the wasm binary, not a .node addon',
        relPath,
        saw: `.wasm target "${name}" ships a .node payload`,
      })
    }
    return findings
  }

  // node/exe with no platform tail is a base/family package (e.g. `@pnpm/exe`,
  // `acorn.rs.node` family loader), not a per-platform tail — out of scope.
  if (tail === '') {
    return findings
  }

  if (target === 'node') {
    if (payloadDomain === 'cli') {
      findings.push({
        fix: 'a .node target ships a <name>.node addon, not a bin/ executable',
        relPath,
        saw: `.node target "${name}" ships a bin payload`,
      })
    }
    if (!isNapiTarget(tail)) {
      findings.push({
        fix: 'use a napi-rs target after .node (-gnu/-musl/-msvc explicit, darwin bare), e.g. darwin-arm64, linux-x64-gnu, win32-x64-msvc',
        relPath,
        saw: `.node target tail "${tail}" in "${name}" is not a napi-rs target`,
      })
      return findings
    }
    if (tail !== 'wasm32-wasi') {
      pushEngineFindings(
        findings,
        relPath,
        m,
        napiTargetEngineFields(tail as NapiNativeTarget),
        `napi target ${tail}`,
      )
    }
    return findings
  }

  // target === 'exe'
  if (payloadDomain === 'napi') {
    findings.push({
      fix: 'an .exe target ships a bin/ executable, not a .node addon',
      relPath,
      saw: `.exe target "${name}" ships a .node payload`,
    })
  }
  if (!isPackAppTriplet(tail)) {
    findings.push({
      fix: 'use a pack-app triplet after .exe (glibc unsuffixed, -musl only, no -gnu/-msvc), e.g. darwin-arm64, linux-x64, linux-x64-musl, win32-arm64',
      relPath,
      saw: `.exe target tail "${tail}" in "${name}" is not a pack-app triplet`,
    })
    return findings
  }
  pushEngineFindings(
    findings,
    relPath,
    m,
    tripletEngineFields(tail),
    `triplet ${tail}`,
  )
  return findings
}

/**
 * Validate a legacy (hyphen-only, no-dot) per-platform tail — domain derived
 * from the payload shape, platform parsed off the trailing `-<segment>`.
 */
function checkLegacyTail(
  relPath: string,
  m: ManifestShape,
  name: string,
): DomainFinding[] {
  const domain = classifyDomain(m)
  if (domain === undefined) {
    return []
  }
  const packApp = parseTripletSegment(name)
  const napi = parseNapiTargetSegment(name)
  // Not suffixed with any platform identifier → not a per-platform tail.
  if (packApp === undefined && napi === undefined) {
    return []
  }

  const findings: DomainFinding[] = []
  if (domain === 'cli') {
    if (packApp === undefined) {
      findings.push({
        fix: 'rename the tail to end in a pack-app triplet (glibc unsuffixed, no -gnu/-msvc), e.g. linux-x64, win32-arm64',
        relPath,
        saw: `executable tail "${name}" carries a napi-domain suffix "${napi}" — binaries follow pnpm pack-app naming`,
      })
    } else {
      pushEngineFindings(
        findings,
        relPath,
        m,
        tripletEngineFields(packApp),
        `triplet ${packApp}`,
      )
    }
    return findings
  }

  // napi domain.
  if (napi === undefined || napi === 'wasm32-wasi') {
    if (napi === undefined) {
      findings.push({
        fix: 'rename the tail to end in a napi-rs target (-gnu/-musl/-msvc explicit, darwin bare), e.g. linux-x64-gnu, win32-x64-msvc',
        relPath,
        saw: `.node tail "${name}" carries a pack-app (binary-domain) suffix "${packApp}" — abi/napi follows napi-rs naming`,
      })
    }
    return findings
  }
  pushEngineFindings(
    findings,
    relPath,
    m,
    napiTargetEngineFields(napi as NapiNativeTarget),
    `napi target ${napi}`,
  )
  return findings
}

/**
 * Validate one manifest against its naming domain. Returns findings (empty =
 * conformant or out of scope). Dotted names (a `.node`/`.wasm`/`.exe` target
 * segment) classify by target token; legacy hyphen-only names classify by
 * payload.
 */
export function checkManifest(
  relPath: string,
  m: ManifestShape,
): DomainFinding[] {
  const name = typeof m.name === 'string' ? m.name : ''
  if (!name) {
    return []
  }
  const unscoped = name.includes('/')
    ? name.slice(name.lastIndexOf('/') + 1)
    : name
  const dotted = parseDottedTarget(unscoped)
  if (dotted !== undefined) {
    return checkDottedTail(relPath, m, name, dotted)
  }
  return checkLegacyTail(relPath, m, name)
}

export function runCheck(repoRoot: string): number {
  const findings: DomainFinding[] = []
  for (const file of collectManifestPaths(repoRoot)) {
    let parsed: ManifestShape
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as ManifestShape
    } catch {
      continue
    }
    findings.push(...checkManifest(path.relative(repoRoot, file), parsed))
  }
  if (findings.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[platform-tails-match-naming-domain] platform tail(s) violate their naming domain.',
      '',
      '  Dot-naming reads the domain from the target token in the name:',
      '  .node → napi-rs tail (linux-x64-gnu, win32-x64-msvc — ABI explicit,',
      '  darwin bare); .exe → pack-app tail (linux-x64, win32-arm64 — glibc',
      '  unsuffixed); .wasm → platformless. The payload must agree.',
      '',
      ...findings.flatMap(f => [
        `    - ${f.relPath}`,
        `        saw:  ${f.saw}`,
        `        fix:  ${f.fix}`,
      ]),
      '',
      '  Doctrine: docs/agents.md/fleet/binary-vs-napi-naming.md',
      '',
    ].join('\n'),
  )
  return 1
}

function main(): void {
  process.exitCode = runCheck(REPO_ROOT)
}

try {
  main()
} catch (e) {
  logger.error(e)
  process.exitCode = 1
}
