/*
 * @file Hand-authored declarations for cut-immutable-release.mjs — the cut
 *   stays plain .mjs because the github-release composite action runs it on
 *   the runner's system Node before any install exists, so the typed test
 *   surface is declared here.
 */

export interface FsLike {
  existsSync(path: string): boolean
}

export type NotesResolution =
  | { notesArgs: string[]; refusal?: undefined }
  | { notesArgs?: undefined; refusal: string }

export declare function refusalForProbes(options: {
  releaseExists: boolean
  repository: string
  tag: string
  tagOnOrigin: boolean
}): string | undefined

export declare function resolveTitle(title: string, tag: string): string

export declare function resolveNotesArgs(
  options: {
    notes: string
    notesFile: string
    tag: string
  },
  fsLike?: FsLike | undefined,
): NotesResolution

export declare function parseAssetList(assets: string): string[]

export declare function assetRefusal(
  assetPaths: string[],
  fsLike?: FsLike | undefined,
): string | undefined

export declare function dryRunPlan(options: {
  assetPaths: string[]
  notesArgs: string[]
  tag: string
  title: string
}): string[]

export declare function runCut(
  options?:
    | {
        assets?: string | undefined
        dryRun?: string | undefined
        execImpl?: ((args: string[]) => number) | undefined
        fsLike?: FsLike | undefined
        log?: ((message: string) => void) | undefined
        logError?: ((message: string) => void) | undefined
        notes?: string | undefined
        notesFile?: string | undefined
        releaseExists?: boolean | undefined
        repository?: string | undefined
        tag?: string | undefined
        tagOnOrigin?: boolean | undefined
        title?: string | undefined
      }
    | undefined,
): number
