/*
 * @file Hand-authored declarations for install-sfw.mjs — the dep-0 bootstrap
 *   installer stays plain .mjs, it runs before any install, so the typed test
 *   surface is declared here.
 */

/**
 * What actually landed on disk. The flavor is read back from the install, never
 * echoed from the request, so a caller can only report the build it really has.
 */
export interface InstalledSfw {
  bin: string
  flavor: 'enterprise' | 'free'
  version: string
}

export declare function installSfw(
  platform: string,
  enterprise: boolean,
): InstalledSfw | undefined
