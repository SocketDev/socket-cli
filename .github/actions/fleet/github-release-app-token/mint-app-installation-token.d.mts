/*
 * @file Hand-authored declarations for mint-app-installation-token.mjs — the
 *   action entry stays plain .mjs (it runs under the GitHub Actions node with
 *   no build step), so the pure, unit-tested surface is declared here.
 */

export declare function parsePermissions(
  rawInput: string | undefined,
): Record<string, string> | undefined

export declare function parseRepositories(
  rawInput: string | undefined,
): string[] | undefined
