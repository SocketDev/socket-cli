#!/usr/bin/env node
/**
 * @file `external-tools add <name>` — create a NEW tool entry, either a
 *   github-release tool (fetch + SRI-verify every platform asset) or an npm
 *   tool (purl + registry integrity). Reuses the phase-1 bulk updater's
 *   curlSha512 / hexToSri / fetchNpmVersionIntegrity so the integrity is
 *   computed the SAME way a bump computes it — one asset-verification codepath.
 *   FAILS LOUD (throws, aborting before any write) when an asset can't be
 *   fetched or the registry has no integrity for the version — refusing to
 *   persist an entry with an unverifiable integrity. Dry-run by default: prints
 *   the entry it would write; `--apply` commits it through EditableJson so the
 *   new key is appended without reflowing the rest of the file. Usage: node
 *   scripts/fleet/external-tools/add.mts <name> --repo <slug> --version <v>
 *   [--tag <t>] [--platform <key>=<asset> …] [--release <kind>] [--binary-name
 *   <n>] [--description <d>] [--target <file>] [--apply] node
 *   scripts/fleet/external-tools/add.mts <name> --npm <pkg> --version <v>
 *   [--description <d>] [--target <file>] [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  DEFAULT_ADD_RELATIVE_PATH,
  loadManifest,
  relPath,
  requireValue,
} from './_shared.mts'
import { curlSha512, fetchNpmVersionIntegrity, hexToSri } from './update.mts'
import type {
  GithubReleaseTool,
  NpmTool,
  PlatformEntry,
  Tool,
} from './update.mts'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// ---------------------------------------------------------------------------
// Entry builders (network isolated behind injectable deps for the unit test)
// ---------------------------------------------------------------------------

export interface BuildGithubEntryOptions {
  // owner/repo (a leading `github:` is tolerated + stripped).
  repo: string
  // Stored in the `version` field verbatim.
  version: string
  // The release tag used to build the asset download URL; defaults to
  // `version` (a tool whose tag differs from its stored version passes --tag).
  tag?: string | undefined
  // platform-key → upstream asset filename.
  platforms: Record<string, string>
  description?: string | undefined
  release?: string | undefined
  binaryName?: string | undefined
}

export interface BuildGithubEntryDeps {
  curlSha512?: ((url: string) => string | undefined) | undefined
  hexToSri?: ((hex: string) => string) | undefined
}

/**
 * Build a GitHub-release tool entry, fetching + SRI-verifying every platform
 * asset. Reuses the bulk updater's `curlSha512` + `hexToSri` so the integrity
 * is computed the SAME way a bump does. FAILS LOUD (throws) if any asset can't
 * be fetched — refusing to write an entry with an unverifiable integrity, the
 * same safety the updater enforces on a bump.
 */
export function buildGithubEntry(
  config: BuildGithubEntryOptions,
  deps?: BuildGithubEntryDeps | undefined,
): GithubReleaseTool {
  const cfg = { __proto__: null, ...config } as typeof config
  const d = {
    __proto__: null,
    curlSha512,
    hexToSri,
    ...deps,
  } as {
    curlSha512: NonNullable<BuildGithubEntryDeps['curlSha512']>
    hexToSri: NonNullable<BuildGithubEntryDeps['hexToSri']>
  }
  const slug = cfg.repo.replace(/^github:/, '')
  const tag = cfg.tag ?? cfg.version
  const platformKeys = Object.keys(cfg.platforms)
  if (platformKeys.length === 0) {
    throw new Error(
      'add: a github tool needs at least one --platform <key>=<asset>.',
    )
  }
  const platforms: Record<string, PlatformEntry> = {}
  for (let i = 0, { length } = platformKeys; i < length; i += 1) {
    const key = platformKeys[i]!
    const asset = cfg.platforms[key]!
    const assetUrl = `https://github.com/${slug}/releases/download/${tag}/${asset}`
    const hex = d.curlSha512(assetUrl)
    if (!hex) {
      throw new Error(
        `add: ${key} asset fetch failed for "${asset}" at ${tag} (${slug}). ` +
          `Refusing to write an entry with an unverifiable integrity. ` +
          `Fix: confirm the release + asset name, then retry.`,
      )
    }
    platforms[key] = { asset, integrity: d.hexToSri(hex) }
  }
  const entry: GithubReleaseTool = {
    version: cfg.version,
    repository: `github:${slug}`,
    release: cfg.release ?? 'asset',
    platforms,
  }
  if (cfg.description) {
    entry.description = cfg.description
  }
  if (cfg.binaryName) {
    ;(entry as unknown as Record<string, unknown>)['binaryName'] =
      cfg.binaryName
  }
  return entry
}

export interface BuildNpmEntryOptions {
  npmName: string
  version: string
  description?: string | undefined
}

export interface BuildNpmEntryDeps {
  fetchNpmVersionIntegrity?:
    | ((name: string, version: string) => Promise<string | undefined>)
    | undefined
}

/**
 * Build an npm tool entry (purl + registry integrity) for an EXACT version,
 * reusing the updater's `fetchNpmVersionIntegrity`. Throws if the registry has
 * no integrity for that version.
 */
export async function buildNpmEntry(
  config: BuildNpmEntryOptions,
  deps?: BuildNpmEntryDeps | undefined,
): Promise<NpmTool> {
  const cfg = { __proto__: null, ...config } as typeof config
  const d = {
    __proto__: null,
    fetchNpmVersionIntegrity,
    ...deps,
  } as {
    fetchNpmVersionIntegrity: NonNullable<
      BuildNpmEntryDeps['fetchNpmVersionIntegrity']
    >
  }
  const integrity = await d.fetchNpmVersionIntegrity(cfg.npmName, cfg.version)
  if (!integrity) {
    throw new Error(
      `add: npm integrity fetch failed for ${cfg.npmName}@${cfg.version}. ` +
        `Fix: confirm the version exists on the registry, then retry.`,
    )
  }
  const entry: NpmTool = {
    integrity,
    repository: `npm:${cfg.npmName}`,
    version: cfg.version,
  }
  if (cfg.description) {
    entry.description = cfg.description
  }
  return entry
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface AddOptions {
  name: string | undefined
  target: string | undefined
  apply: boolean
  repo: string | undefined
  npm: string | undefined
  version: string | undefined
  tag: string | undefined
  description: string | undefined
  release: string | undefined
  binaryName: string | undefined
  platforms: Record<string, string>
}

export function parseArgs(argv: string[] = process.argv.slice(2)): AddOptions {
  const opts: AddOptions = {
    name: undefined,
    target: undefined,
    apply: false,
    repo: undefined,
    npm: undefined,
    version: undefined,
    tag: undefined,
    description: undefined,
    release: undefined,
    binaryName: undefined,
    platforms: {},
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      opts.apply = true
    } else if (a === '--target') {
      opts.target = requireValue(argv, i, '--target')
      i += 1
    } else if (a === '--repo') {
      opts.repo = requireValue(argv, i, '--repo')
      i += 1
    } else if (a === '--npm') {
      opts.npm = requireValue(argv, i, '--npm')
      i += 1
    } else if (a === '--version') {
      opts.version = requireValue(argv, i, '--version')
      i += 1
    } else if (a === '--tag') {
      opts.tag = requireValue(argv, i, '--tag')
      i += 1
    } else if (a === '--description') {
      opts.description = requireValue(argv, i, '--description')
      i += 1
    } else if (a === '--release') {
      opts.release = requireValue(argv, i, '--release')
      i += 1
    } else if (a === '--binary-name') {
      opts.binaryName = requireValue(argv, i, '--binary-name')
      i += 1
    } else if (a === '--platform') {
      const spec = requireValue(argv, i, '--platform')
      const eq = spec.indexOf('=')
      if (eq <= 0) {
        throw new Error(`--platform expects <key>=<asset>, got "${spec}"`)
      }
      opts.platforms[spec.slice(0, eq)] = spec.slice(eq + 1)
      i += 1
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown argument: ${a}`)
    } else if (opts.name === undefined) {
      opts.name = a
    } else {
      throw new Error(`Unexpected positional argument: ${a}`)
    }
  }
  return opts
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  if (!opts.name) {
    logger.error('add requires a tool name: add <name> …')
    return 1
  }
  if (!opts.version) {
    logger.error('add requires --version <v>.')
    return 1
  }
  if (!opts.repo && !opts.npm) {
    logger.error('add requires either --repo <slug> or --npm <pkg>.')
    return 1
  }
  if (opts.repo && opts.npm) {
    logger.error('add: pass only one of --repo or --npm, not both.')
    return 1
  }
  const target = opts.target
    ? path.resolve(opts.target)
    : path.join(REPO_ROOT, DEFAULT_ADD_RELATIVE_PATH)
  // Build (+ verify) the entry BEFORE touching disk — a fetch failure aborts
  // this single add without ever writing a half-verified entry.
  let entry: Tool
  if (opts.npm) {
    entry = await buildNpmEntry({
      npmName: opts.npm,
      version: opts.version,
      description: opts.description,
    })
  } else {
    entry = buildGithubEntry({
      repo: opts.repo!,
      version: opts.version,
      tag: opts.tag,
      platforms: opts.platforms,
      description: opts.description,
      release: opts.release,
      binaryName: opts.binaryName,
    })
  }
  const editable = await loadManifest(target)
  if (editable.content.tools?.[opts.name] !== undefined) {
    logger.error(
      `Tool "${opts.name}" already exists in ${relPath(target)}. ` +
        `Use \`edit\` to change it or \`delete\` first.`,
    )
    return 1
  }
  process.stdout.write(
    `${opts.apply ? 'Adding' : 'Would add'} "${opts.name}" to ${relPath(target)}:\n`,
  )
  process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
  if (!opts.apply) {
    process.stdout.write('\nDry run. Pass --apply to write.\n')
    return 0
  }
  // Append the new key through EditableJson so the rest of the file keeps its
  // key order + formatting (a surgical one-key diff).
  editable.update({
    tools: { ...editable.content.tools, [opts.name]: entry },
  })
  await editable.save({ sort: false })
  process.stdout.write(`\nWrote ${relPath(target)}\n`)
  return 0
}

// Guarded so importing this module (the unit test) doesn't run the CLI. Fail-
// soft: surface the reason via logger.error, set a non-zero exit code, never a
// raw unhandled throw.
if (import.meta.main) {
  main().then(
    code => {
      process.exitCode = code
    },
    e => {
      logger.error(errorMessage(e))
      process.exitCode = 1
    },
  )
}
