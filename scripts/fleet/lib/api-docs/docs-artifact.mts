/**
 * @file The write/check engine both fleet doc generators run on. It owns the
 *   three decisions neither renderer should repeat: whether the member opted
 *   into the artifact (`docs.apiMd` / `docs.llmsTxt` in
 *   `.config/repo/socket-wheelhouse.json`), whether the package has an export
 *   surface to document at all, and — in `--check` mode — whether the committed
 *   file still matches what the renderer produces.
 *   Both gates are VISIBLE no-ops: a member that did not opt in, and a member
 *   whose package.json exports nothing, each get a named skip line and no file.
 *   Neither prints a success line, and neither writes an empty artifact.
 *   Staleness is compared on whitespace-normalized text so a formatter's table
 *   alignment never reads as drift. Formatting itself is owned by
 *   `format:check`, not by this gate.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { writeThroughMirrorLock } from '../../_shared/mirror-lock.mts'
import { loadSocketWheelhouseConfig, REPO_ROOT } from '../../paths.mts'
import { buildApiExportRows, groupApiExportRows } from './export-rows.mts'

import type { ApiExportRow } from './export-rows.mts'

/**
 * The `docs` opt-in keys a member can set, one per generated artifact.
 */
export type DocsArtifactKey = 'apiMd' | 'llmsTxt'

/**
 * Everything a renderer needs about the package it is documenting.
 */
export interface DocsRenderContext {
  readonly groups: ReadonlyMap<string, ApiExportRow[]>
  readonly packageDescription: string
  readonly packageName: string
  readonly rows: readonly ApiExportRow[]
}

/**
 * One artifact's identity: the opt-in key that turns it on, the path it owns,
 * the command that regenerates it, and how it renders.
 */
export interface DocsArtifactSpec {
  /**
   * The command named in every skip / staleness message.
   */
  readonly command: string
  readonly key: DocsArtifactKey
  readonly render: (context: DocsRenderContext) => string
  /**
   * Repo-relative unix-slash path the generator owns exclusively.
   */
  readonly relPath: string
}

/**
 * What a run decided. Every variant carries the line to print; only `stale`
 * is a failure.
 */
export type DocsArtifactOutcome =
  | { readonly kind: 'current'; readonly message: string }
  | { readonly kind: 'disabled'; readonly message: string }
  | { readonly kind: 'no-exports'; readonly message: string }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'written'; readonly message: string }

export interface DocsArtifactOptions {
  readonly checkOnly?: boolean | undefined
  /**
   * Called with the absolute path just written, so the file lands formatted.
   * Defaults to {@link formatGeneratedDoc}; a test injects a no-op seam.
   */
  readonly onWrite?: ((absPath: string) => Promise<void>) | undefined
  readonly repoRoot?: string | undefined
}

/**
 * True when the member named this artifact in the `docs` block of
 * `.config/repo/socket-wheelhouse.json`. Absent config, absent block, and an
 * unset key all mean OFF — a cascade never plants a doc artifact in a member
 * that did not ask for one.
 */
export function isDocsArtifactEnabled(
  key: DocsArtifactKey,
  repoRoot: string = REPO_ROOT,
): boolean {
  const loaded = loadSocketWheelhouseConfig(repoRoot)
  if (!loaded) {
    return false
  }
  const docs = loaded.value['docs']
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) {
    return false
  }
  return (docs as Record<string, unknown>)[key] === true
}

/**
 * Whitespace-normalized markdown, for comparing a committed artifact against a
 * fresh render. Collapses runs of spaces inside a line and drops trailing blank
 * lines, so a formatter re-aligning a table column is not reported as staleness
 * while any change to the words or the link targets still is.
 */
export function normalizeGeneratedDoc(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n+$/, '')
}

/**
 * Read the package manifest and build the render context. Returns `undefined`
 * when there is no package.json, no `exports` map, or no subpath the generators
 * document — the "nothing to document" case each caller reports as a skip.
 */
export function resolveDocsRenderContext(
  repoRoot: string,
): DocsRenderContext | undefined {
  const manifestPath = path.join(repoRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    return undefined
  }
  let manifest: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    manifest = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  const rows = buildApiExportRows(manifest['exports'], repoRoot)
  if (!rows.length) {
    return undefined
  }
  const name = manifest['name']
  const description = manifest['description']
  return {
    groups: groupApiExportRows(rows),
    packageDescription: typeof description === 'string' ? description : '',
    packageName: typeof name === 'string' ? name : path.basename(repoRoot),
    rows,
  }
}

/**
 * Route a freshly written doc through the fleet formatter so the committed
 * bytes match what `format:check` expects. Best-effort: formatting is a
 * separate gate, and a missing formatter must not fail generation.
 */
export async function formatGeneratedDoc(
  absPath: string,
  repoRoot: string = REPO_ROOT,
): Promise<void> {
  try {
    await spawn('node', ['scripts/fleet/format.mts', absPath], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
  } catch {}
}

/**
 * Generate (or, with `checkOnly`, verify) one artifact. Never throws for an
 * expected shape — the caller turns the outcome into a log line and an exit
 * code.
 */
export async function runDocsArtifact(
  spec: DocsArtifactSpec,
  options?: DocsArtifactOptions | undefined,
): Promise<DocsArtifactOutcome> {
  const opts = { __proto__: null, ...options } as DocsArtifactOptions
  const repoRoot = opts.repoRoot ?? REPO_ROOT
  const checkOnly = opts.checkOnly === true

  if (!isDocsArtifactEnabled(spec.key, repoRoot)) {
    return {
      kind: 'disabled',
      message: `${spec.relPath} skipped: set docs.${spec.key} in .config/repo/socket-wheelhouse.json to generate it. No file written.`,
    }
  }

  const context = resolveDocsRenderContext(repoRoot)
  if (!context) {
    return {
      kind: 'no-exports',
      message: `${spec.relPath} skipped: package.json declares no documentable subpath exports, so there is nothing to generate. No file written.`,
    }
  }

  const rendered = spec.render(context)
  const absPath = path.join(repoRoot, spec.relPath)

  if (checkOnly) {
    if (!existsSync(absPath)) {
      return {
        kind: 'stale',
        message: `${spec.relPath} is missing — run: ${spec.command}`,
      }
    }
    const committed = readFileSync(absPath, 'utf8')
    if (normalizeGeneratedDoc(committed) !== normalizeGeneratedDoc(rendered)) {
      return {
        kind: 'stale',
        message: `${spec.relPath} is stale — run: ${spec.command}`,
      }
    }
    return {
      kind: 'current',
      message: `${spec.relPath} is current (${context.rows.length} exports)`,
    }
  }

  mkdirSync(path.dirname(absPath), { recursive: true })
  writeThroughMirrorLock(absPath, rendered)
  await (opts.onWrite ?? (p => formatGeneratedDoc(p, repoRoot)))(absPath)
  return {
    kind: 'written',
    message: `wrote ${spec.relPath} (${context.rows.length} exports)`,
  }
}
