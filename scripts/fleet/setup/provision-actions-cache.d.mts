/*
 * @file Hand-authored declarations for provision-actions-cache.mjs — the
 *   provisioner stays plain .mjs (it runs before any install exists, the
 *   bootstrap-zero-dep-packages.mjs constraint), so its typed surface is
 *   declared here for the .mts importers and the unit suite.
 */

export declare function provisionWithNpm(
  prefixDir: string,
  npmArgs: readonly string[],
): number | null
