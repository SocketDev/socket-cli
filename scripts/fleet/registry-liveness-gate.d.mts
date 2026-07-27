/*
 * @file Hand-authored declarations for registry-liveness-gate.mjs — the gate
 *   stays plain .mjs because github-release.yml runs it on the runner's
 *   system Node before any install exists, so the typed test surface is
 *   declared here.
 */

export interface FsLike {
  existsSync(path: string): boolean
  globSync(
    pattern: string,
    options?: { cwd?: string | undefined } | undefined,
  ): string[]
  readFileSync(path: string, encoding: string): string
}

export type GatePlan =
  | { name: string; registry: 'npm' }
  | { names: string[]; registry: 'crates' }
  | { registry: 'none' }

export interface FetchLike {
  (url: string): Promise<{ ok: boolean; text(): Promise<string> }>
}

export declare function versionFromTag(tag: string): string

export declare function deriveCrateNames(
  rootDir: string,
  fsLike?: FsLike | undefined,
): string[]

export declare function planGate(
  rootDir: string,
  fsLike?: FsLike | undefined,
): GatePlan

export declare function crateIndexPath(name: string): string

export declare function indexHasVersion(
  indexBody: string,
  version: string,
): boolean

export declare function checkNpmLive(
  name: string,
  version: string,
  fetchImpl?: FetchLike | undefined,
  logError?: ((message: string) => void) | undefined,
): Promise<boolean>

export declare function checkCrateLive(
  name: string,
  version: string,
  fetchImpl?: FetchLike | undefined,
  logError?: ((message: string) => void) | undefined,
): Promise<boolean>

export declare function runGate(
  options?:
    | {
        fetchImpl?: FetchLike | undefined
        log?: ((message: string) => void) | undefined
        logError?: ((message: string) => void) | undefined
        rootDir?: string | undefined
        tag?: string | undefined
      }
    | undefined,
): Promise<number>
