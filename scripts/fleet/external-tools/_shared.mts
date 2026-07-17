#!/usr/bin/env node
/*
 * @file Shared plumbing for the external-tools CRUD verb set (list / show / add
 *   / edit / prune / delete). Three concerns live here so each verb file stays
 *   a thin fail-soft CLI shell:
 *
 *   1. Manifest resolution — `resolveManifestPaths` globs the shipped
 *      external-tools.json set (the root build/release manifest, the setup
 *      manifest, the security-hook manifest, and the cascaded template/base
 *      mirrors) down to the ones that actually exist; `resolveTargets` narrows
 *      to a single `--target` when given.
 *   2. Format-preserving I/O — `loadManifest` reads through socket-lib's
 *      `EditableJson` so a verb's `.update({ … })` / `.save({ sort:false })`
 *      keeps key order + indentation (a surgical diff), never a
 *      JSON.parse→stringify reflow.
 *   3. Pure describe / list helpers the read verbs render. The fetch / SRI /
 *      soak-plan machinery is NOT re-implemented here — `add` imports
 *      curlSha512 / hexToSri / fetchNpmVersionIntegrity straight from
 *      ./update.mts (the phase-1 bulk updater), so there is one
 *      asset-verification codepath fleet-wide.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getEditableJsonClass } from '@socketsecurity/lib/json/edit'
import type { EditableJsonInstance } from '@socketsecurity/lib/json/types'

import { REPO_ROOT } from '../paths.mts'
import type { ExternalToolsJson, Tool } from './update.mts'

// ---------------------------------------------------------------------------
// Manifest resolution
// ---------------------------------------------------------------------------

// Every external-tools.json the repo ships, repo-root-relative. The root has no
// template/base mirror (it's wheelhouse-only build/release config); the other
// two are cascaded, so their template/base source-of-truth copies are listed
// too. build/release-bundle copies are generated artifacts — deliberately NOT
// listed (CRUD operates on sources, never build output).
export const MANIFEST_RELATIVE_PATHS: readonly string[] = [
  'external-tools.json',
  'scripts/fleet/setup/external-tools.json',
  '.claude/hooks/fleet/setup-security-tools/external-tools.json',
  'template/base/scripts/fleet/setup/external-tools.json',
  'template/base/.claude/hooks/fleet/setup-security-tools/external-tools.json',
]

// The default `add` target when --target is omitted: the root build/release
// manifest. `add` can't glob "every manifest containing the tool" (a new tool
// is in none), so it writes to one canonical file — override with --target.
export const DEFAULT_ADD_RELATIVE_PATH = 'external-tools.json'

/**
 * The shipped manifests that actually exist under `repoRoot`, absolute. Missing
 * candidates are dropped so a repo that carries only a subset still works.
 */
export function resolveManifestPaths(repoRoot: string = REPO_ROOT): string[] {
  const candidates = MANIFEST_RELATIVE_PATHS
  const out: string[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const abs = path.join(repoRoot, candidates[i]!)
    if (existsSync(abs)) {
      out.push(abs)
    }
  }
  return out
}

/**
 * The manifests a multi-manifest verb (list / show / edit / prune / delete)
 * operates on: a single `--target` when given, else every shipped manifest that
 * exists.
 */
export function resolveTargets(
  options?: { target?: string | undefined } | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    target?: string | undefined
  }
  if (opts.target) {
    return [path.resolve(opts.target)]
  }
  return resolveManifestPaths()
}

/**
 * Load a manifest as an `EditableJson` instance — the format-preserving handle
 * every verb reads (`.content`) and mutates (`.update` / `.save`). Throws on a
 * missing / unparseable file (the caller decides fail-soft vs. fatal).
 */
export async function loadManifest(
  manifestPath: string,
): Promise<EditableJsonInstance<ExternalToolsJson>> {
  const EditableJson = getEditableJsonClass<ExternalToolsJson>()
  return await EditableJson.load(manifestPath)
}

/**
 * A manifest path rendered relative to the repo root for human-readable output
 * (falls back to the absolute path when it lies outside the root).
 */
export function relPath(manifestPath: string): string {
  return path.relative(REPO_ROOT, manifestPath) || manifestPath
}

// ---------------------------------------------------------------------------
// Pure describe / list helpers (the `list` + `show` views)
// ---------------------------------------------------------------------------

export interface ToolDescription {
  kind: string
  version: string
}

/**
 * Classify a tool entry for the `list` view: its distribution kind + the
 * version string a human scans for. Purl-based entries report the ecosystem
 * (`purl:npm`, `purl:pypi`); GitHub entries report `github:<release>` (or
 * `github:version-only` for an informational pin with no platforms map);
 * everything else is a bare `version` pin (git, node, …).
 */
export function describeTool(tool: Tool): ToolDescription {
  const t = tool as unknown as Record<string, unknown>
  const purl = typeof t['purl'] === 'string' ? (t['purl'] as string) : undefined
  const repository =
    typeof t['repository'] === 'string'
      ? (t['repository'] as string)
      : undefined
  const version =
    typeof t['version'] === 'string' ? (t['version'] as string) : undefined
  const release =
    typeof t['release'] === 'string' ? (t['release'] as string) : undefined
  if (purl) {
    const m = /^pkg:(?<eco>[^/]+)\/.+@(?<ver>[^@]+)$/.exec(purl)
    if (m?.groups) {
      return { kind: `purl:${m.groups['eco']}`, version: m.groups['ver']! }
    }
    return { kind: 'purl', version: purl }
  }
  if (repository?.startsWith('github:')) {
    const kind = t['platforms']
      ? `github:${release ?? 'asset'}`
      : release
        ? `github:${release}`
        : 'github:version-only'
    return { kind, version: version ?? '(none)' }
  }
  if (repository) {
    return { kind: 'other', version: version ?? '(none)' }
  }
  return { kind: 'version', version: version ?? '(none)' }
}

export interface ToolSummary {
  name: string
  version: string
  kind: string
}

/**
 * One `{ name, version, kind }` summary per tool, in manifest order — the rows
 * the `list` verb prints.
 */
export function listTools(json: Readonly<ExternalToolsJson>): ToolSummary[] {
  const entries = Object.entries(json.tools ?? {})
  const out: ToolSummary[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [name, tool] = entries[i]!
    const { kind, version } = describeTool(tool)
    out.push({ name, version, kind })
  }
  return out
}

// ---------------------------------------------------------------------------
// CLI arg helpers
// ---------------------------------------------------------------------------

/**
 * The value following a `--flag` at index `i`, or throw a legible error when a
 * flag that requires a value is last on the line.
 */
export function requireValue(argv: string[], i: number, flag: string): string {
  const next = argv[i + 1]
  if (next === undefined) {
    throw new Error(`${flag} requires a value`)
  }
  return next
}
