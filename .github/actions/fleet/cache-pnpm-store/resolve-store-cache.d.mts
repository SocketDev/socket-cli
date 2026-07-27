/*
 * @file Hand-authored declarations for resolve-store-cache.mjs — the
 *   resolver stays plain .mjs because the fleet cache-pnpm-store action runs
 *   it on the runner's system Node before any install exists, so the typed
 *   test surface is declared here.
 */

export interface StorePathResolution {
  fallback: boolean
  storePath: string
}

export declare function resolveStorePath(context: {
  home: string
  localAppData: string
  queriedPath: string
  runnerOs: string
}): StorePathResolution

export declare function nodeMajorForKey(nodeVersion: string): string

export declare function composeCacheKey(parts: {
  cacheVersion: string
  keyPrefix: string
  lockfileHash: string
  nodeMajor: string
  runnerOs: string
}): string

export declare function runResolve(
  options?:
    | {
        appendEnv?: ((line: string) => void) | undefined
        appendOutput?: ((line: string) => void) | undefined
        env?: Record<string, string | undefined> | undefined
        log?: ((message: string) => void) | undefined
        nodeVersion?: string | undefined
      }
    | undefined,
): void
