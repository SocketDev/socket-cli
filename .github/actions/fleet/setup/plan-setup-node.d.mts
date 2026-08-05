/*
 * @file Hand-authored declarations for plan-setup-node.mjs — the decision
 *   core stays plain .mjs because the fleet setup action runs it on the
 *   runner's system Node before any install exists, so the typed test surface
 *   is declared here.
 */

export type NodeVersionSpec =
  | { kind: 'exact'; version: string }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'unsupported' }

export interface NodeDistAsset {
  asset: string
  binRelDir: string
}

export declare function parseNodeVersionSpec(wanted: string): NodeVersionSpec

export declare function resolveNodeVersionFrom(
  wanted: string,
  indexVersions: readonly string[],
): string | undefined

export declare function nodeDistAsset(
  version: string,
  platform: string,
): NodeDistAsset | undefined

export declare function sriFromShasums(
  shasumsText: string,
  asset: string,
): string | undefined
