/**
 * Optional Model Distribution System.
 *
 * Manages lazy-loading of AI models via dlx (no npm/pnpm/yarn required).
 * Models are downloaded from models.socket.dev and cached locally.
 *
 * Architecture:
 * - Core CLI (~13.6 MB): Embedded in binary, works immediately
 * - Optional models: Downloaded via dlx on first use, cached for future runs
 * - optionalDependencies in package.json: Manifest/registry only
 *
 * Usage:
 *   const { modelPaths, downloaded } = await loadOptionalModel('@socketsecurity/cli-embeddings')
 *   // modelPaths[0] = minilm-model.onnx
 *   // modelPaths[1] = minilm-tokenizer.json
 *
 * Cache management:
 *   - Location: ~/.socket/cache/dlx/<sha256>/
 *   - TTL: 30 days (configurable)
 *   - Verification: SHA-512 checksums (npm/cacache pattern)
 *   - Auto-cleanup: Old cache entries removed automatically
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/lib/logger'

import { dlxBinary, getDlxCachePath } from './dlx/binary.mts'

/**
 * Model registry mapping package names to download URLs.
 * This serves as the "manifest" for available optional models.
 */
const MODEL_REGISTRY = {
  __proto__: null,
  '@socketsecurity/cli-embeddings': {
    version: '1.0.0',
    description: 'Semantic package search and similarity detection',
    totalSize: 8_500_000,
    files: [
      {
        url: 'https://models.socket.dev/minilm-int4-v1.0.0.onnx',
        name: 'minilm-model.onnx',
        checksum: '', // TODO: Generate SHA-512 after models are built.
        size: 8_000_000,
      },
      {
        url: 'https://models.socket.dev/minilm-tokenizer-v1.0.0.json',
        name: 'minilm-tokenizer.json',
        checksum: '', // TODO: Generate SHA-512 after models are built.
        size: 500_000,
      },
    ],
  },
  '@socketsecurity/cli-code-analysis': {
    version: '1.0.0',
    description: 'Code vulnerability analysis and explanations',
    totalSize: 85_500_000,
    files: [
      {
        url: 'https://models.socket.dev/codet5-encoder-int4-v1.0.0.onnx',
        name: 'codet5-encoder.onnx',
        checksum: '', // TODO: Generate SHA-512 after models are built.
        size: 28_000_000,
      },
      {
        url: 'https://models.socket.dev/codet5-decoder-int4-v1.0.0.onnx',
        name: 'codet5-decoder.onnx',
        checksum: '', // TODO: Generate SHA-512 after models are built.
        size: 57_000_000,
      },
      {
        url: 'https://models.socket.dev/codet5-tokenizer-v1.0.0.json',
        name: 'codet5-tokenizer.json',
        checksum: '', // TODO: Generate SHA-512 after models are built.
        size: 500_000,
      },
    ],
  },
} as const

interface ModelFile {
  url: string
  name: string
  checksum: string
  size: number
}

interface ModelInfo {
  version: string
  description: string
  totalSize: number
  files: ModelFile[]
}

/**
 * Download and cache optional models via dlx.
 *
 * @param packageName - Package name from MODEL_REGISTRY
 * @returns Model paths and download status
 */
export async function loadOptionalModel(
  packageName: string
): Promise<{ modelPaths: string[]; downloaded: boolean }> {
  const modelInfo = MODEL_REGISTRY[packageName] as ModelInfo | undefined
  if (!modelInfo) {
    throw new Error(`Unknown optional model: ${packageName}`)
  }

  logger.info(`${modelInfo.description}`)
  logger.info(
    `Total size: ${(modelInfo.totalSize / 1024 / 1024).toFixed(1)} MB`
  )

  const modelPaths: string[] = []
  let anyDownloaded = false

  for (const file of modelInfo.files) {
    // Download via dlx (uses cache if available).
    const result = await dlxBinary([], {
      url: file.url,
      name: file.name,
      checksum: file.checksum || undefined,
      cacheTtl: 30 * 24 * 60 * 60 * 1000, // 30 days.
    })

    modelPaths.push(result.binaryPath)
    if (result.downloaded) {
      anyDownloaded = true
    }
  }

  return { modelPaths, downloaded: anyDownloaded }
}

/**
 * Check if optional model is cached.
 *
 * @param packageName - Package name from MODEL_REGISTRY
 * @returns True if all model files exist in cache
 */
export function isModelCached(packageName: string): boolean {
  const modelInfo = MODEL_REGISTRY[packageName] as ModelInfo | undefined
  if (!modelInfo) {
    return false
  }

  // Check if all model files exist in cache.
  const cacheDir = getDlxCachePath()

  for (const file of modelInfo.files) {
    const cacheKey = createHash('sha256').update(file.url).digest('hex')
    const cachePath = path.join(cacheDir, cacheKey, file.name)
    if (!existsSync(cachePath)) {
      return false
    }
  }

  return true
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
  const modelInfo = MODEL_REGISTRY[packageName] as ModelInfo | undefined
  return modelInfo || null
}
