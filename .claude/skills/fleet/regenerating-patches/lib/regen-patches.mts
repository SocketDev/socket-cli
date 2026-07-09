#!/usr/bin/env node
/*
 * @file patch/diff plumbing for the `regenerating-patches` skill — the
 *   mechanical half of regenerating wheelhouse plugin-cache patches against a
 *   freshly-pinned upstream source, so the skill keeps only the AI judgment
 *   (re-apply the patch intent with Edit against the new pristine source) and
 *   the human-stop inline. Reads `.claude-plugin/marketplace.json` pins,
 *   classifies each patch as {stale|upstreamed|current} via `patch --dry-run`
 *   (forward + reverse), and rebuilds a clean `diff -u` body with stripped
 *   timestamps and a restamped `# @` header. Pristine sources are fetched from
 *   `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/<file>` via the lib's
 *   `httpText` (NOT raw fetch). Never commits — the user reviews regen output.
 *
 *   Library: import { classifyPatch, fetchPristine, rebuildDiff } from './regen-patches.mts'
 *   CLI:     node .../lib/regen-patches.mts classify          — print {stale|upstreamed|current} per patch
 *            node .../lib/regen-patches.mts pristine <patch>  — fetch + stage pristine a/ tree, print dir
 *            node .../lib/regen-patches.mts rebuild <patch>   — emit a clean restamped diff from a b/ tree
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpText } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const REPO_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  '../../../../../../../..',
)
const MARKETPLACE_PATH = path.join(
  REPO_ROOT,
  '.claude-plugin',
  'marketplace.json',
)
const PATCHES_DIR = path.join(REPO_ROOT, 'scripts', 'fleet', 'plugin-patches')

const HEADER_LINE_RE = /^#/
const DIFF_PATH_RE = /^--- a\/(.+)$/
const TIMESTAMP_LINE_RE = /^[-+]{3}.*\t/
const RAW_BASE = 'https://raw.githubusercontent.com'

export type PatchClassification = 'current' | 'stale' | 'upstreamed'

export interface PluginPin {
  readonly name: string
  readonly owner: string
  readonly path: string
  readonly repo: string
  readonly sha: string
}

export interface ParsedPatch {
  readonly body: string
  readonly header: string
  readonly plugin: string
  readonly targetPaths: readonly string[]
}

/**
 * Read `marketplace.json` and return one pin per plugin, with owner/repo parsed
 * from `source.url` and the in-repo `source.path` (empty string when absent).
 */
export async function readPins(): Promise<readonly PluginPin[]> {
  const raw = await readFile(MARKETPLACE_PATH, 'utf8')
  const manifest = JSON.parse(raw) as {
    plugins: ReadonlyArray<{
      name: string
      source: { path?: string | undefined; sha: string; url: string }
    }>
  }
  const pins: PluginPin[] = []
  for (
    let i = 0, { length } = manifest.plugins, { plugins } = manifest;
    i < length;
    i += 1
  ) {
    const plugin = plugins[i]!
    const { source } = plugin
    // github.com/<owner>/<repo> — optional .git suffix.
    const match = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(source.url)
    if (!match) {
      throw new Error(
        `cannot parse owner/repo from source.url ${source.url} for plugin ${plugin.name}`,
      )
    }
    pins.push({
      __proto__: null,
      name: plugin.name,
      owner: match[1]!,
      path: source.path ?? '',
      repo: match[2]!,
      sha: source.sha,
    } as PluginPin)
  }
  return pins
}

/**
 * Split a patch file into its `# @…` header and the `diff -u` body, and collect
 * the plugin-root-relative `a/…` target paths.
 */
export function parsePatch(content: string): ParsedPatch {
  const lines = content.split('\n')
  const headerLines: string[] = []
  let bodyStart = lines.length
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('--- ')) {
      bodyStart = i
      break
    }
    if (HEADER_LINE_RE.test(line) || line === '') {
      headerLines.push(line)
    }
  }
  const body = lines.slice(bodyStart).join('\n')
  const targetPaths: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = DIFF_PATH_RE.exec(lines[i]!)
    if (match) {
      targetPaths.push(match[1]!)
    }
  }
  const pluginMatch = /^# @plugin:\s*(\S+)/m.exec(content)
  return {
    __proto__: null,
    body,
    header: headerLines.join('\n'),
    plugin: pluginMatch?.[1] ?? '',
    targetPaths,
  } as ParsedPatch
}

/**
 * Fetch a pristine file from the pinned-SHA raw URL via `httpText`.
 */
export async function fetchPristine(options: {
  file: string
  pin: PluginPin
}): Promise<string> {
  const { file, pin } = { __proto__: null, ...options } as typeof options
  const segments = [pin.owner, pin.repo, pin.sha, pin.path, file].filter(
    Boolean,
  )
  const url = `${RAW_BASE}/${segments.join('/')}`
  try {
    return await httpText(url)
  } catch (e) {
    throw new Error(`fetch ${url} failed: ${errorMessage(e)}`)
  }
}

/**
 * Run `patch -p1` and resolve to its exit code (0 = applies), never throwing on
 * a non-zero apply — the lib `spawn` rejects with `{ code }` on failure. `cwd`
 * must be the de-prefixed tree root (the `a/` dir), since `-p1` strips the
 * leading `a/` segment. The diff is written to a temp file and fed via `-i`
 * because the lib `spawn` does not wire child stdin.
 */
export async function patchDryRun(options: {
  cwd: string
  patchBody: string
  reverse?: boolean | undefined
}): Promise<number> {
  const { cwd, patchBody, reverse } = {
    __proto__: null,
    ...options,
  } as typeof options
  const patchFile = path.join(
    os.tmpdir(),
    `regen-body-${process.pid}-${Date.now()}.patch`,
  )
  await writeFile(patchFile, patchBody, 'utf8')
  const args = ['-p1', '--dry-run', '--forward', '--batch', '-i', patchFile]
  if (reverse) {
    args.push('--reverse')
  }
  try {
    await spawn('patch', args, { cwd })
    return 0
  } catch (e) {
    const code = (e as { code?: number | string | undefined } | undefined)?.code
    return typeof code === 'number' ? code : 1
  }
}

/**
 * Materialize each target file's pristine copy under `<dir>/a/<file>` so a
 * dry-run / diff can run against it. Returns the staging dir.
 */
export async function stagePristine(options: {
  dir: string
  patch: ParsedPatch
  pin: PluginPin
}): Promise<string> {
  const { dir, patch, pin } = { __proto__: null, ...options } as typeof options
  for (let i = 0, { length } = patch.targetPaths; i < length; i += 1) {
    const file = patch.targetPaths[i]!
    const pristine = await fetchPristine({ file, pin })
    const dest = path.join(dir, 'a', file)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, pristine, 'utf8')
  }
  return dir
}

/**
 * Classify a patch against its pinned source:
 * - `current`     — forward dry-run applies (exit 0).
 * - `upstreamed`  — forward fails but reverse applies (fix already upstream).
 * - `stale`       — neither direction applies (needs regenerating).
 */
export async function classifyPatch(options: {
  patch: ParsedPatch
  pin: PluginPin
}): Promise<PatchClassification> {
  const { patch, pin } = { __proto__: null, ...options } as typeof options
  const dir = await mkdtempStaging('classify')
  await stagePristine({ dir, patch, pin })
  const aDir = path.join(dir, 'a')
  const forward = await patchDryRun({ cwd: aDir, patchBody: patch.body })
  if (forward === 0) {
    return 'current'
  }
  const reverse = await patchDryRun({
    cwd: aDir,
    patchBody: patch.body,
    reverse: true,
  })
  if (reverse === 0) {
    return 'upstreamed'
  }
  return 'stale'
}

/**
 * Build a clean `diff -u` body between the pristine `a/<file>` tree and a
 * `b/<file>` tree that already holds the re-applied intent, with timestamps
 * stripped and paths rewritten to `a/`-`b/` plugin-root-relative form.
 */
export async function rebuildDiff(options: {
  dir: string
  targetPaths: readonly string[]
}): Promise<string> {
  const { dir, targetPaths } = { __proto__: null, ...options } as typeof options
  const chunks: string[] = []
  for (let i = 0, { length } = targetPaths; i < length; i += 1) {
    const file = targetPaths[i]!
    const aPath = path.join(dir, 'a', file)
    const bPath = path.join(dir, 'b', file)
    let raw = ''
    try {
      await spawn('diff', ['-u', aPath, bPath])
    } catch (e) {
      // `diff` exits 1 when files differ — that is the success path; its stdout
      // carries the unified diff. Any other failure (exit ≥2) is a real error.
      const err = e as
        | { code?: number | string | undefined; stdout?: string | undefined }
        | undefined
      if (err?.code === 1 && typeof err.stdout === 'string') {
        raw = err.stdout
      } else {
        throw new Error(`diff ${aPath} ${bPath} failed: ${errorMessage(e)}`)
      }
    }
    chunks.push(normalizeDiffPaths({ aPath, bPath, file, raw }))
  }
  return chunks.join('')
}

/**
 * Rewrite absolute `---`/`+++` paths to `a/<file>`/`b/<file>` and drop the
 * trailing-timestamp form `diff -u` emits (which `patch` chokes on).
 */
export function normalizeDiffPaths(options: {
  aPath: string
  bPath: string
  file: string
  raw: string
}): string {
  const { aPath, bPath, file, raw } = {
    __proto__: null,
    ...options,
  } as typeof options
  const out: string[] = []
  const lines = raw.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    let line = lines[i]!
    if (TIMESTAMP_LINE_RE.test(line)) {
      line = line.replace(/\t.*$/, '')
    }
    if (line.startsWith('--- ') && line.includes(aPath)) {
      line = `--- a/${file}`
    } else if (line.startsWith('+++ ') && line.includes(bPath)) {
      line = `+++ b/${file}`
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Restamp the `# @sha:` (and optionally `# @plugin-version:`) header lines to
 * the current pin, leaving every other header line verbatim.
 */
export function restampHeader(options: {
  header: string
  pin: PluginPin
  version?: string | undefined
}): string {
  const { header, pin, version } = {
    __proto__: null,
    ...options,
  } as typeof options
  let out = header.replace(/^(# @sha:\s*).*$/m, `$1${pin.sha}`)
  if (version) {
    out = out.replace(/^(# @plugin-version:\s*).*$/m, `$1${version}`)
  }
  return out
}

/**
 * Validate a full regenerated patch (header + body) against the pristine `a/`
 * tree: `patch -p1 --dry-run` must exit 0.
 */
export async function validatePatch(options: {
  body: string
  patch: ParsedPatch
  pin: PluginPin
}): Promise<boolean> {
  const { body, patch, pin } = { __proto__: null, ...options } as typeof options
  const dir = await mkdtempStaging('validate')
  await stagePristine({ dir, patch, pin })
  const code = await patchDryRun({ cwd: path.join(dir, 'a'), patchBody: body })
  return code === 0
}

/**
 * Create a unique staging directory under the OS temp dir.
 */
export async function mkdtempStaging(label: string): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `plugin-patch-${label}-${process.pid}-${Date.now()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Resolve a patch basename or path to its absolute path in the patches dir.
 */
export function resolvePatchPath(patchArg: string): string {
  const abs = path.isAbsolute(patchArg)
    ? patchArg
    : path.join(PATCHES_DIR, patchArg)
  if (!existsSync(abs)) {
    throw new Error(`patch not found: ${abs}`)
  }
  return abs
}

/**
 * Match a parsed patch to its plugin pin by the `# @plugin:` header.
 */
export function pinForPatch(options: {
  patch: ParsedPatch
  pins: readonly PluginPin[]
}): PluginPin {
  const { patch, pins } = { __proto__: null, ...options } as typeof options
  const pin = pins.find(p => p.name === patch.plugin)
  if (!pin) {
    throw new Error(
      `no marketplace pin for plugin ${patch.plugin || '(unknown)'}`,
    )
  }
  return pin
}

/**
 * CLI entry. See the file header for subcommands.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv
  if (command === 'classify') {
    const pins = await readPins()
    const { glob } = await import('node:fs/promises')
    const entries: string[] = []
    for await (const name of glob('*.patch', { cwd: PATCHES_DIR })) {
      entries.push(name)
    }
    entries.sort()
    const report: Record<string, PatchClassification> = {
      __proto__: null,
    } as unknown as Record<string, PatchClassification>
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      const patch = parsePatch(
        await readFile(path.join(PATCHES_DIR, name), 'utf8'),
      )
      const pin = pinForPatch({ patch, pins })
      report[name] = await classifyPatch({ patch, pin })
    }
    logger.log(JSON.stringify(report, undefined, 2))
    return
  }
  if (command === 'pristine') {
    const patchArg = rest[0]
    if (!patchArg) {
      logger.fail('usage: regen-patches.mts pristine <patch>')
      process.exitCode = 1
      return
    }
    const pins = await readPins()
    const patch = parsePatch(await readFile(resolvePatchPath(patchArg), 'utf8'))
    const pin = pinForPatch({ patch, pins })
    const dir = await mkdtempStaging('pristine')
    await stagePristine({ dir, patch, pin })
    logger.log(dir)
    return
  }
  if (command === 'rebuild') {
    const patchArg = rest[0]
    const dirArg = rest[1]
    if (!patchArg || !dirArg) {
      logger.fail('usage: regen-patches.mts rebuild <patch> <staging-dir>')
      process.exitCode = 1
      return
    }
    const pins = await readPins()
    const patch = parsePatch(await readFile(resolvePatchPath(patchArg), 'utf8'))
    const pin = pinForPatch({ patch, pins })
    const body = await rebuildDiff({
      dir: dirArg,
      targetPaths: patch.targetPaths,
    })
    const header = restampHeader({ header: patch.header, pin })
    const full = `${header}\n${body}`
    const valid = await validatePatch({ body, patch, pin })
    if (!valid) {
      logger.fail(
        'regenerated diff does not apply cleanly (patch --dry-run != 0)',
      )
      process.exitCode = 1
      return
    }
    logger.log(full)
    return
  }
  logger.fail('usage: regen-patches.mts <classify|pristine|rebuild> [...]')
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
