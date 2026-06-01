/**
 * @file Fleet-canonical GitHub Release publisher. Companion to
 *   `template/scripts/publish.mts` — that one handles the npm-registry side
 *   (`pnpm stage publish` + provenance). This one handles the GitHub-Release
 *   side: hash artifacts, write a signed checksums manifest, optionally pin
 *   them into a source-tree `release-assets.json` for downstream consumers,
 *   then cut the release with `gh release create`. Trust model: GitHub Releases
 *   don't get npm-style provenance. Instead the trust comes from two anchors
 *   that BOTH go into the release:
 *
 *   1. `checksums.txt` — SHA-256 of every asset, written by
 *      producer.mts:writeChecksumsFile (deterministic ordering for stable
 *      diffs).
 *   2. (Optional) `release-assets.json` in the source tree — pins the tag +
 *      per-asset checksum so downstream consumer repos (the ones using
 *      `release-checksums/consumer.mts`) can verify what they download against
 *      a checked-in expected value. The pin IS the cross-repo trust contract.
 *      Per-repo config — drop a `release-assets.config.mts` at the repo root
 *      that exports `config` of type `ReleaseAssetsConfig` (see below). The
 *      orchestrator imports it via dynamic import; the config file is per-repo
 *      (not cascaded), the orchestrator is fleet-canonical. CLI: pnpm run
 *      publish:release # cut a release pnpm run publish:release --dry-run #
 *      hash + simulate gh release pnpm run publish:release --no-pin # skip
 *      source-tree pin update pnpm run publish:release --tag <t> # override
 *      computed tag Produces: <buildDir>/checksums.txt # SHA-256 manifest
 *      <pinManifest.path> # source-tree pin updated GitHub Release <tag> #
 *      uploaded assets
 */

import { existsSync, statSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import url from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  updateReleaseAssets,
  writeChecksumsFile,
} from '../../packages/build-infra/lib/release-checksums/producer.mts'
import { gitShortSha, runInherit } from './publish-shared.mts'

const logger = getDefaultLogger()
const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

/**
 * Per-repo release config. Drop one at `<repo-root>/release-assets.config.mts`
 * that `export const config: ReleaseAssetsConfig = { … }`.
 */
export interface ReleaseAssetsConfig {
  /**
   * Build directory containing assets to publish. Hashed in full; the canonical
   * orchestrator reads every file matching `assetPatterns`.
   */
  buildDir: string
  /**
   * Glob patterns relative to `buildDir`. Matched files are uploaded to the
   * GitHub Release; `checksums.txt` is written next to them and is always
   * included regardless of patterns.
   */
  assetPatterns: readonly string[]
  /**
   * Tag for this release. Called once per orchestrator run; receives a date
   * string + git short SHA the orchestrator already computed in case the
   * producer wants to reuse them. Returning a string commits to that tag for
   * the rest of the run.
   */
  tag: (ctx: { date: string; shortSha: string }) => string | Promise<string>
  /**
   * Optional release notes file (markdown). Passed to `gh release create
   * --notes-file`. Omit to let the release have no body.
   */
  notesFile?: string | undefined
  /**
   * Optional source-tree pin. When set, the orchestrator updates the named
   * `tool` block of `<repo-root>/<pinManifest.path>` with the new tag +
   * per-asset checksums, so downstream `release-checksums/ consumer.mts`
   * callers can verify their downloads against a checked-in expected value.
   */
  pinManifest?:
    | {
        path: string
        tool: string
        description?: string | undefined
      }
    | undefined
}

interface CliArgs {
  dryRun: boolean
  noPin: boolean
  tagOverride: string | undefined
}

async function main(): Promise<void> {
  const args = parseCli()
  const config = await loadConfig()

  const buildDirAbs = path.resolve(rootPath, config.buildDir)
  if (!existsSync(buildDirAbs)) {
    logger.fail(
      `buildDir does not exist: ${config.buildDir} (resolved to ${buildDirAbs}). Build artifacts first.`,
    )
    process.exitCode = 1
    return
  }

  // Resolve the tag. Either --tag override wins, or config.tag()
  // computes one given the date + short SHA.
  const date = new Date().toISOString().slice(0, 10)
  const shortSha = await gitShortSha(rootPath)
  const tag =
    args.tagOverride ?? (await Promise.resolve(config.tag({ date, shortSha })))
  if (!tag) {
    logger.fail('Config did not produce a tag (config.tag() returned empty).')
    process.exitCode = 1
    return
  }

  logger.log(`Release tag: ${tag}`)
  logger.log(`Build dir:   ${path.relative(rootPath, buildDirAbs)}`)

  // Phase 1: Hash and write checksums.txt.
  const checksumsPath = path.join(buildDirAbs, 'checksums.txt')
  logger.log('Hashing assets…')
  const checksums = await writeChecksumsFile({
    inputDir: buildDirAbs,
    outputPath: checksumsPath,
  })
  const assetCount = Object.keys(checksums).length
  logger.success(
    `Wrote ${assetCount} entries to ${path.relative(rootPath, checksumsPath)}`,
  )

  // Phase 2: Update source-tree pin (when configured and --no-pin wasn't passed).
  if (config.pinManifest && !args.noPin) {
    const manifestAbs = path.resolve(rootPath, config.pinManifest.path)
    if (args.dryRun) {
      logger.log(
        `[dry-run] would update ${path.relative(rootPath, manifestAbs)} tool=${config.pinManifest.tool} tag=${tag}`,
      )
    } else {
      updateReleaseAssets({
        manifestPath: manifestAbs,
        tool: config.pinManifest.tool,
        tag,
        checksums,
        description: config.pinManifest.description,
      })
      logger.success(`Updated pin: ${path.relative(rootPath, manifestAbs)}`)
    }
  }

  // Phase 3: Collect the asset paths the gh release create call needs.
  const assetPaths = await collectAssetPaths(buildDirAbs, config.assetPatterns)
  // checksums.txt always uploaded so consumers can fetch it without
  // pre-knowing where it lives. Add it if not already in the pattern set.
  if (!assetPaths.includes(checksumsPath)) {
    assetPaths.push(checksumsPath)
  }
  logger.log(`Uploading ${assetPaths.length} asset(s) to release ${tag}`)

  // Phase 4: gh release create.
  const ghArgs = ['release', 'create', tag, ...assetPaths]
  if (config.notesFile) {
    const notesAbs = path.resolve(rootPath, config.notesFile)
    if (!existsSync(notesAbs)) {
      logger.fail(`Notes file not found: ${config.notesFile}`)
      process.exitCode = 1
      return
    }
    ghArgs.push('--notes-file', notesAbs)
  }
  if (args.dryRun) {
    logger.log(`[dry-run] gh ${ghArgs.join(' ')}`)
    logger.success('Dry-run complete.')
    return
  }
  const code = await runInherit('gh', ghArgs, rootPath)
  if (code !== 0) {
    logger.fail(`gh release create exited ${code}`)
    process.exitCode = code
    return
  }
  logger.success(`Released ${tag}`)
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      'dry-run': { default: false, type: 'boolean' },
      'no-pin': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      tag: { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  })
  if (values['help']) {
    logger.log('Usage: pnpm run publish:release [options]')
    logger.log('')
    logger.log('  --dry-run        hash + simulate; no gh release create')
    logger.log('  --no-pin         skip source-tree release-assets.json update')
    logger.log('  --tag <tag>      override the tag from config.tag()')
    process.exit(0)
  }
  return {
    dryRun: !!values['dry-run'],
    noPin: !!values['no-pin'],
    tagOverride: typeof values['tag'] === 'string' ? values['tag'] : undefined,
  }
}

/**
 * Dynamic-import the per-repo config. We require the file to live at
 * `<repo-root>/release-assets.config.mts` so each repo can keep its tag scheme
 * + asset patterns private without forking this orchestrator.
 */
async function loadConfig(): Promise<ReleaseAssetsConfig> {
  const configPath = path.join(rootPath, 'release-assets.config.mts')
  if (!existsSync(configPath)) {
    logger.fail(
      `Missing release-assets.config.mts at repo root.\n` +
        `  Path:   ${configPath}\n` +
        `  Action: create the file with \`export const config: ReleaseAssetsConfig = { … }\` (see template/scripts/release-assets.mts for the interface).`,
    )
    process.exit(1)
  }
  const mod = (await import(url.pathToFileURL(configPath).href)) as {
    config?: ReleaseAssetsConfig | undefined
  }
  if (!mod.config) {
    logger.fail(
      `release-assets.config.mts must \`export const config: ReleaseAssetsConfig = { … }\`.`,
    )
    process.exit(1)
  }
  return mod.config
}

async function collectAssetPaths(
  buildDir: string,
  patterns: readonly string[],
): Promise<string[]> {
  const result: string[] = []
  for (const pattern of patterns) {
    // eslint-disable-next-line no-await-in-loop
    for await (const match of glob(pattern, { cwd: buildDir })) {
      const abs = path.resolve(buildDir, String(match))
      // Skip directories — gh release create wants files only.
      if (statSync(abs).isFile()) {
        result.push(abs)
      }
    }
  }
  return result
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
