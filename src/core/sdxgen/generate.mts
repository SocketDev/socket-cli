import { createRequire } from 'node:module'
import path from 'node:path'

import { isObject } from '@socketsecurity/lib-stable/objects/predicates'

import { distPath } from '../../constants/paths.mts'

export async function executeSdxgenModule(
  module: unknown,
  projectPath: string,
  options: SdxgenOptions = {},
): Promise<SdxgenDocument> {
  if (!isObject(module) || typeof module['generateSbom'] !== 'function') {
    throw new Error(
      'Cannot load the bundled generator. Where: sdxgen API. Saw an invalid module; wanted generateSbom. Fix: reinstall Socket CLI.',
    )
  }
  const result: unknown = await Reflect.apply(
    module['generateSbom'],
    undefined,
    [
      path.resolve(projectPath),
      {
        ...options,
        executeTools: options.executeTools ?? false,
        format: 'cyclonedx',
      },
    ],
  )
  if (!isSdxgenDocument(result)) {
    throw new Error(
      'Cannot read the generated manifest. Where: sdxgen API. Saw an invalid document; wanted CycloneDX. Fix: report the failing project format.',
    )
  }
  return result
}

export async function generateSdxgenManifest(
  projectPath: string,
  options: SdxgenOptions = {},
): Promise<SdxgenDocument> {
  const require = createRequire(import.meta.url)
  const module: unknown = require(path.join(distPath, 'sdxgen', 'index.cjs'))
  return await executeSdxgenModule(module, projectPath, options)
}

export interface SdxgenOptions {
  executeTools?: boolean | undefined
  recursive?: boolean | undefined
  specVersion?: '1.5' | '1.6' | undefined
}

export interface SdxgenDocument {
  bomFormat: 'CycloneDX'
  specVersion: string
  components?: unknown[] | undefined
  [key: string]: unknown
}

export function isSdxgenDocument(value: unknown): value is SdxgenDocument {
  return (
    isObject(value) &&
    value['bomFormat'] === 'CycloneDX' &&
    typeof value['specVersion'] === 'string' &&
    (value['components'] === undefined || Array.isArray(value['components']))
  )
}
