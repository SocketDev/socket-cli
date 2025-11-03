/**
 * Optional Model Distribution System.
 *
 * Manages lazy-loading of AI models via npm packages (installed on first use).
 * Models are published to npm registry under @socketbin/ scope.
 *
 * Architecture:
 * - Core CLI (~13.6 MB): Embedded in binary, works immediately
 *   - Includes: yoga-layout, onnx-runtime, MiniLM model + tokenizer
 * - Optional models: Installed via npm on first use, cached in node_modules
 * - optionalDependencies in package.json: Auto-installed when available
 *
 * Usage:
 *   const { modelPaths, downloaded } = await loadOptionalModel('@socketbin/cli-ai')
 *   // modelPaths[0] = codet5-encoder.onnx
 *   // modelPaths[1] = codet5-decoder.onnx
 *   // modelPaths[2] = codet5-tokenizer.json
 *
 * Cache management:
 *   - Location: node_modules/@socketbin/cli-ai/
 *   - TTL: Follows npm cache behavior
 *   - Verification: npm integrity checks
 *   - Auto-cleanup: Standard npm prune/clean
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
const logger = getDefaultLogger()


/**
 * Model registry mapping package names to npm packages.
 * This serves as the "manifest" for available optional models.
 *
 * NOTE: MiniLM model + tokenizer are already bundled in dist/cli.js.
 * Additional models will be added here when larger payloads require lazy-loading.
 */
const MODEL_REGISTRY = {
  __proto__: null,
  // Reserved for future optional models (codet5, etc.) when payloads grow.
} as const

interface ModelInfo {
  version: string
  description: string
  totalSize: number
  packageName: string
  files: string[]
}

/**
 * Load optional models from npm package.
 *
 * TODO: Implement dlx-based loading (follow @coana-tech/cli pattern).
 * - Use runShadowCommand() with package manager dlx (npm/pnpm/yarn)
 * - Package manager caches in node_modules for future use
 * - Resolve package location after dlx execution
 * - Return paths to model files
 *
 * @param packageName - Package name from MODEL_REGISTRY
 * @returns Model paths and installation status
 */
export async function loadOptionalModel(
  packageName: string,
): Promise<{ modelPaths: string[]; downloaded: boolean }> {
  const modelInfo = (
    MODEL_REGISTRY as unknown as Record<string, ModelInfo | undefined>
  )[packageName]
  if (!modelInfo) {
    throw new Error(`Unknown optional model: ${packageName}`)
  }

  logger.info(`${modelInfo.description}`)
  logger.info(
    `Total size: ${(modelInfo.totalSize / 1024 / 1024).toFixed(1)} MB`,
  )

  // TODO: Implement dlx-based loading (follow @coana-tech/cli pattern).
  throw new Error('dlx-based model loading not yet implemented')
}

/**
 * Check if optional model package is installed.
 *
 * @param packageName - Package name from MODEL_REGISTRY
 * @returns True if package exists in node_modules
 */
export function isModelCached(packageName: string): boolean {
  const modelInfo = (
    MODEL_REGISTRY as unknown as Record<string, ModelInfo | undefined>
  )[packageName]
  if (!modelInfo) {
    return false
  }

  // TODO: Check if package is cached by package manager.
  // Can use isPackageCached() from preflight/downloads.mts or similar pattern.
  return false
}

/**
 * Get list of available optional models.
 *
 * @returns Array of package names
 */
export function listAvailableModels(): string[] {
  return Object.keys(MODEL_REGISTRY)
}

/**
 * Get model information.
 *
 * @param packageName - Package name from MODEL_REGISTRY
 * @returns Model information or null if not found
 */
export function getModelInfo(packageName: string): ModelInfo | null {
  const modelInfo = (
    MODEL_REGISTRY as unknown as Record<string, ModelInfo | undefined>
  )[packageName]
  return modelInfo || null
}
