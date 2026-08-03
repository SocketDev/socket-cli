/**
 * @file Compat re-export of the old publish-shared surface — the
 *   registry-agnostic helpers (`publish-infra/shared.mts`) + the npm registry
 *   reads (`publish-infra/npm/registry.mts`) — for downstream repo-owned
 *   consumers (e.g. a skill's scripts/publish.mts) that still import
 *   `publish-shared.mts`; kept until the next cascade converges them.
 */

export * from './publish-infra/npm/registry.mts'
export * from './publish-infra/shared.mts'
