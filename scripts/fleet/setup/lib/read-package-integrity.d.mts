/*
 * @file Hand-authored declarations for read-package-integrity.mjs — the dep-0
 *   lockfile-integrity reader stays plain .mjs (it runs before any install
 *   exists), so the typed test surface is declared here.
 */

export declare function readPnpmLockIntegrity(
  content: string,
  pkgName: string,
  version: string,
): string | undefined
