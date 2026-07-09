#!/usr/bin/env node
/*
 * @file Commit-time naming-domain gate — the code-as-law surface for the
 *   binary-vs-napi naming split (ratified 2026-07-04):
 *
 *   - BINARIES (kind `cli`, payload at `bin/…`) follow pnpm pack-app naming:
 *     `<os>-<arch>[-<libc>]`, glibc unsuffixed, no toolchain segment
 *     (`linux-x64`, `win32-arm64`). Canonical set: pack-app-triplets.mts.
 *   - ABI/NAPI (kind `napi`, payload `<name>.node`) follow napi-rs naming:
 *     `platform-arch[-abi]`, `-gnu`/`-musl`/`-msvc` explicit, darwin bare
 *     (`linux-x64-gnu`, `win32-x64-msvc`). Canonical set: napi-targets.mts.
 *
 *   A tail package whose payload shape and name suffix disagree — a `.node`
 *   addon named with a bare pack-app triplet, or an executable named with a
 *   napi ABI segment — makes the artifact kind illegible and breaks the
 *   loaders/allowlists that parse suffixes by domain. The scan classifies each
 *   per-platform tail by its manifest payload (bin field → binary domain;
 *   `.node` in main/files → napi domain) and validates the suffix against
 *   that domain's canonical set, plus os/cpu/libc engine-field consistency.
 *
 *   See docs/agents.md/fleet/binary-vs-napi-naming.md for the doctrine.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  napiTargetEngineFields,
  parseNapiTargetSegment,
} from '../util/napi-targets.mts'
import {
  parseTripletSegment,
  tripletEngineFields,
} from '../util/pack-app-triplets.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface DomainFinding {
  readonly fix: string
  readonly relPath: string
  readonly saw: string
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
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
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

function fieldMatches(actual: unknown, expected: readonly string[]): boolean {
  const got = stringsOf(actual)
  return got.length === expected.length && expected.every(e => got.includes(e))
}

/**
 * Validate one manifest against its naming domain. Returns findings (empty =
 * conformant or out of scope).
 */
export function checkManifest(
  relPath: string,
  m: ManifestShape,
): DomainFinding[] {
  const name = typeof m.name === 'string' ? m.name : ''
  if (!name) {
    return []
  }
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
      const want = tripletEngineFields(packApp)
      if (m.os !== undefined && !fieldMatches(m.os, want.os)) {
        findings.push({
          fix: `set "os": ${JSON.stringify(want.os)}`,
          relPath,
          saw: `os field ${JSON.stringify(stringsOf(m.os))} disagrees with triplet ${packApp}`,
        })
      }
      if (m.cpu !== undefined && !fieldMatches(m.cpu, want.cpu)) {
        findings.push({
          fix: `set "cpu": ${JSON.stringify(want.cpu)}`,
          relPath,
          saw: `cpu field ${JSON.stringify(stringsOf(m.cpu))} disagrees with triplet ${packApp}`,
        })
      }
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
  const want = napiTargetEngineFields(napi)
  if (m.os !== undefined && !fieldMatches(m.os, want.os)) {
    findings.push({
      fix: `set "os": ${JSON.stringify(want.os)}`,
      relPath,
      saw: `os field ${JSON.stringify(stringsOf(m.os))} disagrees with napi target ${napi}`,
    })
  }
  if (m.cpu !== undefined && !fieldMatches(m.cpu, want.cpu)) {
    findings.push({
      fix: `set "cpu": ${JSON.stringify(want.cpu)}`,
      relPath,
      saw: `cpu field ${JSON.stringify(stringsOf(m.cpu))} disagrees with napi target ${napi}`,
    })
  }
  return findings
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
      '  Binaries follow pnpm pack-app naming (linux-x64, win32-arm64 — glibc',
      '  unsuffixed, no toolchain segment). ABI/NAPI .node addons follow',
      '  napi-rs naming (linux-x64-gnu, win32-x64-msvc — ABI explicit, darwin',
      '  bare). The payload shape decides the domain; the suffix must match.',
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
