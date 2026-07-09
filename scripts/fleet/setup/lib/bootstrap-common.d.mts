/*
 * @file Hand-authored declarations for bootstrap-common.mjs — the dep-0
 *   bootstrap helper stays plain .mjs (it runs before any install), so the
 *   typed test surface is declared here.
 */

export declare function resolveReal(cmd: string): string | undefined
export declare function isFirewallShim(filePath: string): boolean
