/*
 * @file Hand-authored declarations for setup-tools-sfw.mjs — the dep-0
 *   bootstrap script stays plain .mjs (it runs before any install), so the
 *   typed test surface is declared here.
 */

export declare function sentinelVarFor(cmd: string): string
export declare function posixRealShimLines(
  cmd: string,
  sfwBin: string,
  real: string,
): string[]
export declare function windowsRealShimLines(
  cmd: string,
  sfwBin: string,
  real: string,
): string[]
