/**
 * WASM build pipeline orchestrator.
 *
 * Declarative orchestrator for wasm-shipping packages. Given a manifest of
 * ordered stages, it drives the canonical sequence:
 *   clone source → configure → compile → release → (optimize) → sync → finalize
 *
 * The orchestrator owns every moving part that today lives in each package's
 * 340-line build.mts:
 *
 * - Build mode + platform-arch detection (uses centralized helpers).
 * - Loading external-tools.json + package.json `sources` metadata.
 * - Deriving a unified cache key from: node version, platform, arch, build
 *   mode, pinned tool versions, and source refs. Tool bump or source SHA bump
 *   invalidates the cache automatically — no hand-wired busting.
 * - Per-stage shouldRun() / createCheckpoint() wrapping. Stages become pure
 *   work functions; they do not implement skip-if-cached themselves.
 * - Common CLI flags: --prod / --dev / --force / --clean /
 *   --clean-stage=<name> / --from-stage=<name> / --cache-key.
 *
 * A stage is `(ctx, params) => Promise<void>`. `ctx` carries derived values
 * shared by every stage (paths, mode, logger, tool versions, source meta).
 * `params` holds stage-local overrides from the manifest.
 *
 * @module build-infra/lib/build-pipeline
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { errorMessage } from '@socketsecurity/lib/errors'

import {
  cleanCheckpoint,
  createCheckpoint,
  shouldRun,
} from './checkpoint-manager.mts'
import { getBuildMode, validateCheckpointChain } from './constants.mts'
import { validateExternalTools } from './external-tools-schema.mts'
import { getCurrentPlatformArch } from './platform-mappings.mts'
import { getNodeVersion } from './version-helpers.mts'

const logger = getDefaultLogger()

/**
 * @typedef {object} StageResult
 * @property {() => Promise<void> | void} [smokeTest]
 *   Post-run validation. Runs before the checkpoint is committed.
 * @property {string} [artifactPath]
 *   Absolute path archived into the checkpoint tarball.
 * @property {string} [binaryPath]
 *   Relative path (from buildDir) to a binary to codesign on macOS.
 * @property {string | number} [binarySize]
 *   Optional size metadata surfaced in checkpoint data.
 */

/**
 * @typedef {object} PipelineStage
 * @property {string} name - Checkpoint name (must appear in CHECKPOINTS).
 * @property {(ctx: PipelineContext, params?: object) => Promise<StageResult | void>} run
 *   Stage worker. Receives the shared context and optional per-stage params.
 *   Should perform the build work only — no shouldRun / createCheckpoint calls.
 *   Return a StageResult to configure the checkpoint (smoke test + artifact).
 * @property {string[]} [sourcePaths]
 *   Extra file paths whose content contributes to this stage's cache hash. The
 *   orchestrator always includes package-wide inputs (external-tools.json,
 *   package.json); list stage-specific inputs here (e.g. an optimization
 *   flags module).
 * @property {boolean} [skipInDev]
 *   Skip this stage entirely when buildMode === 'dev' (e.g. wasm-optimized).
 * @property {(ctx: PipelineContext) => boolean} [skip]
 *   Dynamic skip predicate. Runs before shouldRun(). When it returns true,
 *   the stage is skipped without being recorded as cached. Use when the
 *   skip condition depends on runtime context beyond buildMode (e.g.
 *   socket-cli's SEA stage, which only runs when --force is present).
 * @property {boolean} [shared]
 *   Checkpoint lives at the shared build dir instead of per-platform (e.g.
 *   source-cloned, which is platform-agnostic).
 */

/**
 * @typedef {object} PipelineContext
 * @property {string} packageRoot - Package root (absolute).
 * @property {string} packageName - Friendly name used in logs.
 * @property {string} buildMode - 'dev' or 'prod'.
 * @property {string} platformArch - Canonical platform-arch string.
 * @property {string} nodeVersion - Node version running the build.
 * @property {boolean} forceRebuild - Global --force flag.
 * @property {Record<string, string>} toolVersions - Map of tool name -> pinned version.
 * @property {Record<string, object>} sources - Contents of package.json `sources`.
 * @property {object} paths - Result of the package's getBuildPaths(mode, platformArch).
 * @property {object} sharedPaths - Result of the package's getSharedBuildPaths(), if any.
 * @property {string} cacheKey - Unified cache key for GH Actions.
 * @property {typeof logger} logger
 */

/**
 * @typedef {object} RunPipelineOptions
 * @property {string} packageRoot - Absolute path to the package directory.
 * @property {string} packageName - Short name used in logs (e.g. 'yoga').
 * @property {PipelineStage[]} stages - Stages in execution order.
 * @property {(mode: string, platformArch: string) => object} getBuildPaths
 *   Package's path resolver for mode + platformArch.
 * @property {() => object} [getSharedBuildPaths]
 *   Optional shared-path resolver (for source-cloned tarballs).
 * @property {() => Promise<void>} [preflight]
 *   Optional pre-build check (tool probing, disk space). Runs once before
 *   the first stage. Throws to abort the build.
 * @property {(paths: object) => string[]} [getOutputFiles]
 *   Returns absolute paths to the artifacts the build is expected to emit.
 *   Missing files trigger a full-checkpoint clean to force a rebuild.
 * @property {string[]} [extraCacheInputs]
 *   Extra file paths whose content is mixed into the cache key. Package-wide
 *   inputs (external-tools.json + package.json) are already included.
 * @property {() => Promise<string>} [resolvePlatformArch]
 *   Override platform-arch resolution. Default calls getCurrentPlatformArch()
 *   from platform-mappings (returns e.g. 'darwin-arm64'). Platform-agnostic
 *   builds (e.g. JS bundling in socket-tui) should return a fixed string
 *   like 'universal' so the cache key stays stable across host OSes.
 */

async function readJson(filePath) {
  let raw
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      return undefined
    }
    throw new Error(`Failed to read ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
}

async function loadExternalTools(packageRoot) {
  const filePath = path.join(packageRoot, 'external-tools.json')
  const data = await readJson(filePath)
  if (!data) {
    return { versions: {}, rawHash: '' }
  }
  const validated = validateExternalTools(data)
  if (!validated.ok) {
    const details = validated.errors
      .map(e => `  ${e.path}: ${e.message}`)
      .join('\n')
    throw new Error(
      `Invalid external-tools.json at ${filePath}:\n${details}`,
    )
  }
  const versions = {}
  for (const [tool, meta] of Object.entries(data.tools ?? {})) {
    versions[tool] = meta?.version ?? ''
  }
  const rawHash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 16)
  return { versions, rawHash }
}

async function loadPackageJson(packageRoot) {
  const pkg = await readJson(path.join(packageRoot, 'package.json'))
  if (!pkg) {
    throw new Error(`Missing package.json in ${packageRoot}`)
  }
  return pkg
}

function hashFileContents(files) {
  const hash = createHash('sha256')
  for (const file of files.toSorted()) {
    let content = Buffer.alloc(0)
    if (existsSync(file)) {
      try {
        content = readFileSync(file)
      } catch {}
    }
    hash.update(`${file}:`)
    hash.update(content)
  }
  return hash.digest('hex').slice(0, 16)
}

function buildCacheKey({
  buildMode,
  nodeVersion,
  platformArch,
  sources,
  toolVersions,
  toolsHash,
  packageVersion,
  extraHash,
}) {
  const hash = createHash('sha256')
  hash.update(`node=${nodeVersion}`)
  hash.update(`platformArch=${platformArch}`)
  hash.update(`mode=${buildMode}`)
  hash.update(`tools=${toolsHash}`)
  for (const tool of Object.keys(toolVersions).toSorted()) {
    hash.update(`${tool}@${toolVersions[tool]}`)
  }
  for (const key of Object.keys(sources).toSorted()) {
    const src = sources[key] ?? {}
    hash.update(
      `src:${key}=${src.version ?? ''}:${src.ref ?? ''}:${src.url ?? ''}`,
    )
  }
  if (extraHash) {
    hash.update(`extra=${extraHash}`)
  }
  const digest = hash.digest('hex').slice(0, 12)
  return `v${nodeVersion}-${platformArch}-${buildMode}-${digest}-${packageVersion}`
}

function parseFlags(argv) {
  const args = new Set(argv)
  const getValue = flag => {
    const prefix = `${flag}=`
    for (const arg of argv) {
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length)
      }
    }
    return undefined
  }
  return {
    force: args.has('--force'),
    clean: args.has('--clean'),
    printCacheKey: args.has('--cache-key'),
    cleanStage: getValue('--clean-stage'),
    fromStage: getValue('--from-stage'),
    raw: args,
  }
}

function resolveCheckpointBuildDir(stage, ctx) {
  if (stage.shared && ctx.sharedPaths?.buildDir) {
    return ctx.sharedPaths.buildDir
  }
  return ctx.paths.buildDir
}

async function runStage(stage, ctx, stageParams) {
  const { buildMode, forceRebuild, logger } = ctx

  if (stage.skipInDev && buildMode === 'dev') {
    logger.substep(`Skipping ${stage.name} (dev build)`)
    return
  }

  if (typeof stage.skip === 'function' && stage.skip(ctx)) {
    logger.substep(`Skipping ${stage.name} (skip predicate)`)
    return
  }

  const buildDir = resolveCheckpointBuildDir(stage, ctx)
  const sourcePaths = [
    path.join(ctx.packageRoot, 'external-tools.json'),
    path.join(ctx.packageRoot, 'package.json'),
    ...(stage.sourcePaths ?? []),
  ].filter(p => existsSync(p))

  const platformMeta = stage.shared
    ? {}
    : {
        buildMode,
        nodeVersion: ctx.nodeVersion,
        platform: process.platform,
        arch: process.arch,
      }

  const shouldProceed = await shouldRun(
    buildDir,
    '',
    stage.name,
    forceRebuild,
    sourcePaths,
    platformMeta,
  )

  if (!shouldProceed) {
    logger.substep(`✓ ${stage.name} up-to-date (cached)`)
    return
  }

  logger.step(`Running ${stage.name}`)
  const result = (await stage.run(ctx, stageParams)) ?? {}
  const {
    artifactPath,
    binaryPath,
    binarySize,
    smokeTest = async () => {},
  } = result

  await createCheckpoint(buildDir, stage.name, smokeTest, {
    ...(artifactPath ? { artifactPath } : {}),
    ...(binaryPath ? { binaryPath } : {}),
    ...(binarySize !== undefined ? { binarySize } : {}),
    packageRoot: ctx.packageRoot,
    sourcePaths,
    ...platformMeta,
  })
}

/**
 * Validate + run a pipeline. On --cache-key, prints the key and exits without
 * building. Returns the context so the caller can render a summary.
 *
 * @param {RunPipelineOptions} options
 * @param {object} [cliOverrides] - Pre-parsed flags (for programmatic use).
 * @returns {Promise<PipelineContext>}
 */
export async function runPipeline(options, cliOverrides) {
  const {
    extraCacheInputs = [],
    getBuildPaths,
    getOutputFiles,
    getSharedBuildPaths,
    packageName,
    packageRoot,
    preflight,
    resolvePlatformArch,
    stages,
  } = options

  const flags = cliOverrides ?? parseFlags(process.argv.slice(2))
  const buildMode = getBuildMode(flags.raw ?? new Set())
  const platformArch = resolvePlatformArch
    ? await resolvePlatformArch()
    : await getCurrentPlatformArch()
  const nodeVersion = getNodeVersion().replace(/^v/, '')

  const [pkgJson, { versions: toolVersions, rawHash: toolsHash }] =
    await Promise.all([
      loadPackageJson(packageRoot),
      loadExternalTools(packageRoot),
    ])

  const sources = pkgJson.sources ?? {}
  const packageVersion = pkgJson.version ?? '0.0.0'

  const extraHash =
    extraCacheInputs.length > 0 ? hashFileContents(extraCacheInputs) : ''
  const cacheKey = buildCacheKey({
    buildMode,
    extraHash,
    nodeVersion,
    packageVersion,
    platformArch,
    sources,
    toolsHash,
    toolVersions,
  })

  if (flags.printCacheKey) {
    process.stdout.write(`${cacheKey}\n`)
    return /** @type {any} */ (undefined)
  }

  const paths = getBuildPaths(buildMode, platformArch)
  const sharedPaths = getSharedBuildPaths ? getSharedBuildPaths() : undefined
  const outputFiles = getOutputFiles ? getOutputFiles(paths) : []

  // Validate chain for typos / unknown names.
  validateCheckpointChain(
    stages.map(s => s.name),
    packageName,
  )

  const ctx = {
    buildMode,
    cacheKey,
    forceRebuild: flags.force,
    logger,
    nodeVersion,
    packageName,
    packageRoot,
    paths,
    platformArch,
    sharedPaths,
    sources,
    toolVersions,
  }

  const totalStart = Date.now()
  logger.step(`🔨 Building ${packageName}`)
  logger.info(`Mode: ${buildMode}`)
  logger.info(`Platform: ${platformArch}`)
  logger.info(`Cache key: ${cacheKey}`)
  logger.info('')

  // Handle --clean / --clean-stage / missing-output clean-up.
  if (flags.clean) {
    logger.substep('Clean build requested — removing all checkpoints')
    await cleanCheckpoint(paths.buildDir, '')
    if (sharedPaths?.buildDir) {
      await cleanCheckpoint(sharedPaths.buildDir, '')
    }
  } else if (flags.cleanStage) {
    logger.substep(`Clean requested for stage: ${flags.cleanStage}`)
    // Invalidates this stage + anything depending on it.
    const idx = stages.findIndex(s => s.name === flags.cleanStage)
    if (idx === -1) {
      throw new Error(
        `Unknown --clean-stage=${flags.cleanStage}. Valid: ${stages.map(s => s.name).join(', ')}`,
      )
    }
    for (const stage of stages.slice(idx)) {
      const buildDir = resolveCheckpointBuildDir(stage, ctx)
      const markerDir = path.join(buildDir, 'checkpoints')
      for (const ext of ['.json', '.tar.gz', '.tar.gz.lock']) {
        const file = path.join(markerDir, `${stage.name}${ext}`)
        if (existsSync(file)) {
          await fs.rm(file, { force: true })
        }
      }
    }
  } else if (outputFiles.length && outputFiles.some(p => !existsSync(p))) {
    logger.substep(
      'Output artifacts missing — invalidating all checkpoints to rebuild',
    )
    await cleanCheckpoint(paths.buildDir, '')
    if (sharedPaths?.buildDir) {
      await cleanCheckpoint(sharedPaths.buildDir, '')
    }
  }

  if (preflight) {
    logger.step('Pre-flight Checks')
    await preflight()
    logger.success('Pre-flight checks passed')
  }

  // --from-stage: pretend earlier stages succeeded (they should have cached
  // checkpoints already). We just skip running them.
  let startIdx = 0
  if (flags.fromStage) {
    startIdx = stages.findIndex(s => s.name === flags.fromStage)
    if (startIdx === -1) {
      throw new Error(
        `Unknown --from-stage=${flags.fromStage}. Valid: ${stages.map(s => s.name).join(', ')}`,
      )
    }
    logger.substep(`Starting from stage: ${flags.fromStage}`)
  }

  for (const stage of stages.slice(startIdx)) {
    await runStage(stage, ctx, {})
  }

  const seconds = ((Date.now() - totalStart) / 1000).toFixed(1)
  logger.step('🎉 Build Complete!')
  logger.success(`Total time: ${seconds}s`)
  logger.success(`Output: ${paths.outputFinalDir ?? paths.buildDir}`)
  if (outputFiles.length) {
    logger.info('')
    logger.info('Files:')
    for (const file of outputFiles) {
      logger.info(`  - ${path.relative(packageRoot, file)}`)
    }
    logger.info('')
  }
  return ctx
}

/**
 * CLI entry-point helper. Wraps runPipeline with a top-level error handler.
 * @param {RunPipelineOptions} options
 */
export async function runPipelineCli(options) {
  try {
    await runPipeline(options)
  } catch (e) {
    // Set exit code and rethrow so the caller's top-level handler is the
    // single place that formats/logs the failure. Logging here AND in the
    // caller's catch shows the same error twice.
    process.exitCode = 1
    throw e
  }
}
