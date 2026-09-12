#!/usr/bin/env node

import { cmdAnalytics } from './command/analytics/cmd-analytics.mts'
import { cmdAsk } from './command/ask/cmd-ask.mts'
import { cmdAuditLog } from './command/audit-log/cmd-audit-log.mts'
import { cmdBundler } from './command/bundler/cmd-bundler.mts'
import { cmdCargo } from './command/cargo/cmd-cargo.mts'
import { cmdCI } from './command/ci/cmd-ci.mts'
import { cmdConfig } from './command/config/cmd-config.mts'
import { cmdDoctor } from './command/doctor/cmd-doctor.mts'
import { cmdFix } from './command/fix/cmd-fix.mts'
import { cmdGem } from './command/gem/cmd-gem.mts'
import { cmdGo } from './command/go/cmd-go.mts'
import { cmdInstall } from './command/install/cmd-install.mts'
import { cmdJson } from './command/json/cmd-json.mts'
import { cmdLogin } from './command/login/cmd-login.mts'
import { cmdLogout } from './command/logout/cmd-logout.mts'
import { cmdManifestCdxgen } from './command/manifest/cmd-manifest-cdxgen.mts'
import { cmdManifest } from './command/manifest/cmd-manifest.mts'
import { cmdMcp } from './command/mcp/cmd-mcp.mts'
import { cmdNpm } from './command/npm/cmd-npm.mts'
import { cmdNpx } from './command/npx/cmd-npx.mts'
import { cmdNuget } from './command/nuget/cmd-nuget.mts'
import { cmdOops } from './command/oops/cmd-oops.mts'
import { cmdOptimize } from './command/optimize/cmd-optimize.mts'
import { cmdOrganizationDependencies } from './command/organization/cmd-organization-dependencies.mts'
import { cmdOrganizationPolicyLicense } from './command/organization/cmd-organization-policy-license.mts'
import { cmdOrganizationPolicySecurity } from './command/organization/cmd-organization-policy-security.mts'
import { cmdOrganization } from './command/organization/cmd-organization.mts'
import { cmdPackage } from './command/package/cmd-package.mts'
import { cmdPatch } from './command/patch/cmd-patch.mts'
import { cmdPip } from './command/pip/cmd-pip.mts'
import { cmdPnpm } from './command/pnpm/cmd-pnpm.mts'
import { cmdPyCli } from './command/pycli/cmd-pycli.mts'
import { cmdRawNpm } from './command/raw-npm/cmd-raw-npm.mts'
import { cmdRawNpx } from './command/raw-npx/cmd-raw-npx.mts'
import { cmdRepository } from './command/repository/cmd-repository.mts'
import { cmdScan } from './command/scan/cmd-scan.mts'
import { cmdSfw } from './command/sfw/cmd-sfw.mts'
import { cmdThreatFeed } from './command/threat-feed/cmd-threat-feed.mts'
import { cmdUninstall } from './command/uninstall/cmd-uninstall.mts'
import { cmdUv } from './command/uv/cmd-uv.mts'
import { cmdWhoami } from './command/whoami/cmd-whoami.mts'
import { cmdWrapper } from './command/wrapper/cmd-wrapper.mts'
import { cmdYarn } from './command/yarn/cmd-yarn.mts'

export const rootCommands = {
  analytics: cmdAnalytics,
  ask: cmdAsk,
  'audit-log': cmdAuditLog,
  bundler: cmdBundler,
  cargo: cmdCargo,
  cdxgen: cmdManifestCdxgen,
  ci: cmdCI,
  config: cmdConfig,
  dependencies: cmdOrganizationDependencies,
  doctor: cmdDoctor,
  fix: cmdFix,
  gem: cmdGem,
  go: cmdGo,
  install: cmdInstall,
  json: cmdJson,
  license: cmdOrganizationPolicyLicense,
  login: cmdLogin,
  logout: cmdLogout,
  manifest: cmdManifest,
  mcp: cmdMcp,
  npm: cmdNpm,
  npx: cmdNpx,
  nuget: cmdNuget,
  oops: cmdOops,
  optimize: cmdOptimize,
  organization: cmdOrganization,
  package: cmdPackage,
  patch: cmdPatch,
  pip: cmdPip,
  pnpm: cmdPnpm,
  pycli: cmdPyCli,
  'raw-npm': cmdRawNpm,
  'raw-npx': cmdRawNpx,
  repository: cmdRepository,
  scan: cmdScan,
  security: cmdOrganizationPolicySecurity,
  sfw: cmdSfw,
  'threat-feed': cmdThreatFeed,
  uninstall: cmdUninstall,
  uv: cmdUv,
  whoami: cmdWhoami,
  wrapper: cmdWrapper,
  yarn: cmdYarn,
}

/**
 * Bucket assignments for the `socket --help` layout.
 *
 * Each public command can opt into one of four display buckets, or stay
 * unbucketed (registered + reachable, but not surfaced in the top-level help
 * text — useful for ecosystem-specific commands that are documented elsewhere
 * or experimental commands not yet ready for prominent placement).
 *
 * The help builder reads this map to render the bucketed sections. Adding a new
 * public command = (a) register it in `rootCommands`, (b) optionally add a
 * bucket here. No parallel hand-maintained list to drift.
 *
 * Drift is impossible-by-construction: - A command in this map but not in
 * `rootCommands` would be a compile error (TypeScript narrows the keys). - A
 * command in `rootCommands` but not here = unbucketed, which is a valid state.
 */
export type RootCommandBucket = 'main' | 'api' | 'tools' | 'config'

// Grouped by help-display bucket (main/api/tools/config), not alphabetical.
export const rootCommandBuckets: Readonly<
  Partial<Record<keyof typeof rootCommands, RootCommandBucket>>
  // oxlint-disable-next-line socket/sort-object-literal-properties -- buckets
> = {
  // Main commands — the "hero" actions surfaced first in `socket --help`.
  fix: 'main',
  optimize: 'main',
  doctor: 'main',
  cdxgen: 'main',
  ci: 'main',
  // Socket API — commands that hit the Socket.dev REST API.
  analytics: 'api',
  'audit-log': 'api',
  organization: 'api',
  package: 'api',
  repository: 'api',
  scan: 'api',
  'threat-feed': 'api',
  // Local tools — commands that wrap a local toolchain (npm, pip, …)
  // or operate on the local filesystem without API calls.
  manifest: 'tools',
  npm: 'tools',
  npx: 'tools',
  pycli: 'tools',
  'raw-npm': 'tools',
  'raw-npx': 'tools',
  sfw: 'tools',
  // CLI configuration — login / logout / install / etc.
  config: 'config',
  install: 'config',
  login: 'config',
  logout: 'config',
  uninstall: 'config',
  whoami: 'config',
  wrapper: 'config',
}

export const rootAliases = {
  audit: {
    description: `${cmdAuditLog.description} (alias)`,
    hidden: false,
    argv: ['audit-log'],
  },
  'audit-logs': {
    description: cmdAuditLog.description,
    hidden: true,
    argv: ['audit-log'],
  },
  auditLog: {
    description: cmdAuditLog.description,
    hidden: true,
    argv: ['audit-log'],
  },
  auditLogs: {
    description: cmdAuditLog.description,
    hidden: true,
    argv: ['audit-log'],
  },
  deps: {
    description: `${cmdOrganizationDependencies.description} (alias)`,
    hidden: false,
    argv: ['dependencies'],
  },
  feed: {
    description: `${cmdThreatFeed.description} (alias)`,
    hidden: false,
    argv: ['threat-feed'],
  },
  firewall: {
    description: `${cmdSfw.description} (alias)`,
    hidden: false,
    argv: ['sfw'],
  },
  org: {
    description: `${cmdOrganization.description} (alias)`,
    hidden: false,
    argv: ['organization'],
  },
  organisation: {
    description: cmdOrganization.description,
    hidden: true,
    argv: ['organization'],
  },
  organisations: {
    description: cmdOrganization.description,
    hidden: true,
    argv: ['organization'],
  },
  organizations: {
    description: cmdOrganization.description,
    hidden: true,
    argv: ['organization'],
  },
  orgs: {
    description: cmdOrganization.description,
    hidden: true,
    argv: ['organization'],
  },
  pip3: {
    description: `${cmdPip.description} (alias)`,
    hidden: true,
    argv: ['pip'],
  },
  pkg: {
    description: `${cmdPackage.description} (alias)`,
    hidden: false,
    argv: ['package'],
  },
  repo: {
    description: `${cmdRepository.description} (alias)`,
    hidden: false,
    argv: ['repository'],
  },
  repos: {
    description: cmdRepository.description,
    hidden: true,
    argv: ['repository'],
  },
  repositories: {
    description: cmdRepository.description,
    hidden: true,
    argv: ['repository'],
  },
}
