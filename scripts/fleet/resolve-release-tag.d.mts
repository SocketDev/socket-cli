/*
 * @file Hand-authored declarations for resolve-release-tag.mjs — the resolver
 *   stays plain .mjs because github-release.yml runs it on the runner's
 *   system Node before any install exists, so the typed test surface is
 *   declared here.
 */

export type TagResolution =
  | { ok: true; tag: string }
  | { errorLines: string[]; ok: false }

export declare function resolveReleaseTag(context: {
  eventName: string | undefined
  inputTag: string | undefined
  refName: string | undefined
}): TagResolution

export declare function runResolve(
  options?:
    | {
        appendImpl?: ((path: string, data: string) => void) | undefined
        env?: Record<string, string | undefined> | undefined
        logError?: ((message: string) => void) | undefined
      }
    | undefined,
): number
