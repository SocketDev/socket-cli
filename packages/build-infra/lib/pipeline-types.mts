/**
 * Shared type definitions for the build-pipeline orchestrator. Split out of
 * build-pipeline.mts to keep each module under the fleet file-size cap.
 *
 * @module build-infra/lib/pipeline-types
 */

import type { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

export type PipelineLogger = ReturnType<typeof getDefaultLogger>

/**
 * Contents of a package.json `sources` entry (e.g. a vendored source ref).
 */
export interface SourceMeta {
  ref?: string | undefined
  url?: string | undefined
  version?: string | undefined
}

/**
 * Contents of package.json `sources`, keyed by source name.
 */
export type SourceMap = Record<string, SourceMeta | undefined>

/**
 * Map of tool name -> pinned version, loaded from external-tools.json.
 */
export type ToolVersions = Record<string, string>

/**
 * Result of a package's getBuildPaths(mode, platformArch). Every package
 * defines its own shape; the orchestrator only reads `buildDir` and the
 * optional `outputFinalDir` directly.
 */
export interface BuildPaths {
  [key: string]: unknown
  buildDir: string
  outputFinalDir?: string | undefined
}

/**
 * Result of a package's getSharedBuildPaths(), for platform-agnostic
 * checkpoints (e.g. source-cloned).
 */
export interface SharedBuildPaths {
  [key: string]: unknown
  buildDir?: string | undefined
}

/**
 * Flags parsed from argv by {@link parseFlags}.
 */
export interface ParsedFlags {
  cleanStage: string | undefined
  clean: boolean
  force: boolean
  fromStage: string | undefined
  printCacheKey: boolean
  raw: Set<string>
}

/**
 * Post-run stage output.
 */
export interface StageResult {
  /**
   * Absolute path archived into the checkpoint tarball.
   */
  artifactPath?: string | undefined
  /**
   * Relative path (from buildDir) to a binary to codesign on macOS.
   */
  binaryPath?: string | undefined
  /**
   * Optional size metadata surfaced in checkpoint data.
   */
  binarySize?: string | number | undefined
  /**
   * Post-run validation. Runs before the checkpoint is committed.
   */
  smokeTest?: (() => Promise<void> | void) | undefined
}

/**
 * Context shared by every stage: derived paths, mode, logger, tool versions,
 * source meta.
 */
export interface PipelineContext {
  buildMode: string
  cacheKey: string
  forceRebuild: boolean
  logger: PipelineLogger
  nodeVersion: string
  packageName: string
  packageRoot: string
  paths: BuildPaths
  platformArch: string
  sharedPaths: SharedBuildPaths | undefined
  sources: SourceMap
  toolVersions: ToolVersions
}

/**
 * A pipeline stage. `run` receives the shared context and optional per-stage
 * params; it should perform the build work only (no shouldRun /
 * createCheckpoint calls — the orchestrator wraps those).
 */
export interface PipelineStage {
  /**
   * Checkpoint name (must appear in CHECKPOINTS).
   */
  name: string
  /**
   * Stage worker. Should perform the build work only — no shouldRun /
   * createCheckpoint calls. Return a StageResult to configure the checkpoint
   * (smoke test + artifact).
   */
  run: (
    ctx: PipelineContext,
    params?: Record<string, unknown>,
  ) => Promise<StageResult | void>
  /**
   * Checkpoint lives at the shared build dir instead of per-platform (e.g.
   * source-cloned, which is platform-agnostic).
   */
  shared?: boolean | undefined
  /**
   * Dynamic skip predicate. Runs before shouldRun(). When it returns true,
   * the stage is skipped without being recorded as cached. Use when the skip
   * condition depends on runtime context beyond buildMode (e.g. socket-cli's
   * SEA stage, which only runs when --force is present).
   */
  skip?: ((ctx: PipelineContext) => boolean) | undefined
  /**
   * Skip this stage entirely when buildMode === 'dev' (e.g. wasm-optimized).
   */
  skipInDev?: boolean | undefined
  /**
   * Extra file paths whose content contributes to this stage's cache hash.
   * The orchestrator always includes package-wide inputs (external-tools.json,
   * package.json); list stage-specific inputs here (e.g. an optimization
   * flags module).
   */
  sourcePaths?: string[] | undefined
}

/**
 * Options accepted by {@link runPipeline} / {@link runPipelineCli}.
 */
export interface RunPipelineOptions {
  /**
   * Extra file paths whose content is mixed into the cache key.
   */
  extraCacheInputs?: string[] | undefined
  /**
   * Package's path resolver for mode + platformArch.
   */
  getBuildPaths: (mode: string, platformArch: string) => BuildPaths
  /**
   * Returns absolute paths to the artifacts the build is expected to emit.
   * Missing files trigger a full-checkpoint clean to force a rebuild.
   */
  getOutputFiles?: ((paths: BuildPaths) => string[]) | undefined
  /**
   * Optional shared-path resolver (for source-cloned tarballs).
   */
  getSharedBuildPaths?: (() => SharedBuildPaths) | undefined
  /**
   * Short name used in logs (e.g. 'yoga').
   */
  packageName: string
  /**
   * Absolute path to the package directory.
   */
  packageRoot: string
  /**
   * Optional pre-build check (tool probing, disk space). Runs once before
   * the first stage. Throws to abort the build.
   */
  preflight?: (() => Promise<void>) | undefined
  /**
   * Override platform-arch resolution. Default calls
   * getCurrentPlatformArch() from platform-mappings (returns e.g.
   * 'darwin-arm64'). Platform-agnostic builds (e.g. JS bundling in
   * socket-tui) should return a fixed string like 'universal' so the cache
   * key stays stable across host OSes.
   */
  resolvePlatformArch?: (() => Promise<string>) | undefined
  /**
   * Stages in execution order.
   */
  stages: PipelineStage[]
}

/**
 * Contents of a package.json read via {@link loadPackageJson}.
 */
export interface PackageJsonLike {
  [key: string]: unknown
  sources?: SourceMap | undefined
  version?: string | undefined
}
