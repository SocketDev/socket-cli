/**
 * @file Build target/package configuration + shared type definitions for
 *   the build script modules. Split out of scripts/build.mts to keep each
 *   module under the fleet file-size cap.
 */

export interface BuildPackageConfig {
  filter: string
  /**
   * Glob patterns (repo-relative) whose file contents contribute to the build
   * signature. A change to any matching file invalidates the cache and forces a
   * rebuild.
   */
  inputs: string[]
  name: string
  outputCheck: string
}

export interface BuildResult {
  skipped: boolean
  success: boolean
}

export interface BuildTargetResult {
  duration: string
  success: boolean
  target: string
}

export interface ParsedArgs {
  arch: string | undefined
  buildArgs: string[]
  force: boolean
  help: boolean
  parallel: boolean
  platform: string | undefined
  platforms: boolean
  target: string | undefined
  targets: string[]
}

export const TARGET_PACKAGES: Record<string, string> = {
  __proto__: undefined as unknown as string,
  all: './packages/**',
  cli: '@socketsecurity/cli',
  'cli-sentry': '@socketsecurity/cli-with-sentry',
  socket: 'socket',
}

/**
 * Build configuration for the CLI package — the first (and currently only)
 * entry in the default build order, referenced directly by orchestration
 * steps that build the CLI before platform targets.
 */
export const CLI_BUILD_PACKAGE: BuildPackageConfig = {
  filter: '@socketsecurity/cli',
  inputs: [
    'packages/cli/.config/**/*.{mts,ts,json}',
    'packages/cli/scripts/**/*.{mts,ts}',
    'packages/cli/src/**/*.{mts,ts,cts,json}',
    'packages/cli/package.json',
    'packages/cli/tsconfig.json',
    'packages/build-infra/lib/**/*.{mts,ts}',
    'packages/build-infra/package.json',
    'pnpm-lock.yaml',
    '.node-version',
  ],
  name: 'CLI Package',
  outputCheck: 'packages/cli/dist/index.js',
}

/**
 * Build configuration for each package in the default build order.
 */
export const BUILD_PACKAGES: BuildPackageConfig[] = [CLI_BUILD_PACKAGE]
