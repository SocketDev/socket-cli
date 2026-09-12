import { canonicalOriginAllowed } from './source.mts'
import crypto from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { canonicalPathIsSafe, readCanonicalIndexEntry } from './git.mts'
import type { CanonicalIndexEntry } from './git.mts'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function unscopedTarget(
  manifest: Record<string, unknown>,
  file: string,
): boolean {
  for (const field of [
    'capabilityScopedFiles',
    'conditionalScopedFiles',
    'shapeScopedFiles',
  ]) {
    const groups = manifest[field]
    if (groups === undefined) {
      continue
    }
    if (!Array.isArray(groups)) {
      return false
    }
    for (const value of groups) {
      const files = record(value)?.['files']
      if (!Array.isArray(files) || files.includes(file)) {
        return false
      }
    }
  }
  return true
}

export function canonicalBundleBytesMatch(
  ref: string,
  file: string,
  entry: CanonicalIndexEntry,
  manifest: unknown,
): boolean {
  const parsed = record(manifest)
  const files = record(parsed?.['files'])
  const expected = files?.[file]
  return (
    /^fleet-pack-[0-9a-f]{40}$/u.test(ref) &&
    parsed?.['templateSha'] === ref.slice('fleet-pack-'.length) &&
    unscopedTarget(parsed, file) &&
    canonicalPathIsSafe(file) &&
    entry.mode === '100644' &&
    typeof expected === 'string' &&
    /^[0-9a-f]{64}$/u.test(expected) &&
    crypto.hash('sha256', entry.content, 'hex') === expected
  )
}

const manifests = new Map<string, unknown>()
function fetchManifest(member: string, ref: string): unknown {
  const key = `${member}:${ref}`
  if (!manifests.has(key)) {
    const result = spawnSync(
      process.execPath,
      [path.join(member, 'scripts/fleet/pack/canonical-proof.mts'), ref],
      {
        cwd: member,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        maxBuffer: 4_194_304,
      },
    )
    if (result.status !== 0) {
      return undefined
    }
    const lines = result.stdout.trim().split(/\r?\n/u)
    const manifest: unknown = JSON.parse(lines.at(-1) ?? '')
    if (record(manifest)?.['templateSha'] !== ref.slice('fleet-pack-'.length)) {
      return undefined
    }
    manifests.set(key, manifest)
  }
  return manifests.get(key)
}

export function canonicalBundleCopyMatches(
  member: string,
  file: string,
  entry: CanonicalIndexEntry,
  options: {
    fetchManifest?: ((member: string, ref: string) => unknown) | undefined
  } = {},
): boolean {
  if (!canonicalOriginAllowed(member)) {
    return false
  }
  try {
    const config = readCanonicalIndexEntry(
      member,
      '.config/repo/socket-wheelhouse.json',
    )
    if (!config) {
      return false
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(config.content).toString('utf8'),
    )
    const ref = record(record(parsed)?.['bundle'])?.['ref']
    if (typeof ref !== 'string' || !/^fleet-pack-[0-9a-f]{40}$/u.test(ref)) {
      return false
    }
    return canonicalBundleBytesMatch(
      ref,
      file,
      entry,
      (options.fetchManifest ?? fetchManifest)(member, ref),
    )
  } catch {
    return false
  }
}
