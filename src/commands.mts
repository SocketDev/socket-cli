#!/usr/bin/env node

import { cmdAnalytics } from './commands/analytics/cmd-analytics.mts'
import { cmdAuditLog } from './commands/audit-log/cmd-audit-log.mts'
import { cmdCI } from './commands/ci/cmd-ci.mts'
import { cmdConfig } from './commands/config/cmd-config.mts'
import { cmdFix } from './commands/fix/cmd-fix.mts'
import { cmdInstall } from './commands/install/cmd-install.mts'
import { cmdJson } from './commands/json/cmd-json.mts'
import { cmdLogin } from './commands/login/cmd-login.mts'
import { cmdLogout } from './commands/logout/cmd-logout.mts'
import { cmdManifestCdxgen } from './commands/manifest/cmd-manifest-cdxgen.mts'
import { cmdManifest } from './commands/manifest/cmd-manifest.mts'
import { cmdNpm } from './commands/npm/cmd-npm.mts'
import { cmdNpx } from './commands/npx/cmd-npx.mts'
import { cmdOops } from './commands/oops/cmd-oops.mts'
import { cmdOptimize } from './commands/optimize/cmd-optimize.mts'
import { cmdOrganizationDependencies } from './commands/organization/cmd-organization-dependencies.mts'
import { cmdOrganizationPolicyLicense } from './commands/organization/cmd-organization-policy-license.mts'
import { cmdOrganizationPolicySecurity } from './commands/organization/cmd-organization-policy-security.mts'
import { cmdOrganization } from './commands/organization/cmd-organization.mts'
import { cmdPackage } from './commands/package/cmd-package.mts'
import { cmdPatch } from './commands/patch/cmd-patch.mts'
import { cmdPnpm } from './commands/pnpm/cmd-pnpm.mts'
import { cmdRawNpm } from './commands/raw-npm/cmd-raw-npm.mts'
import { cmdRawNpx } from './commands/raw-npx/cmd-raw-npx.mts'
import { cmdRepository } from './commands/repository/cmd-repository.mts'
import { cmdScan } from './commands/scan/cmd-scan.mts'
import { cmdThreatFeed } from './commands/threat-feed/cmd-threat-feed.mts'
import { cmdUninstall } from './commands/uninstall/cmd-uninstall.mts'
import { cmdWrapper } from './commands/wrapper/cmd-wrapper.mts'
import { cmdYarn } from './commands/yarn/cmd-yarn.mts'

export const rootCommands = {
  analytics: cmdAnalytics,
  'audit-log': cmdAuditLog,
  ci: cmdCI,
  cdxgen: cmdManifestCdxgen,
  config: cmdConfig,
  dependencies: cmdOrganizationDependencies,
  fix: cmdFix,
  install: cmdInstall,
  json: cmdJson,
  license: cmdOrganizationPolicyLicense,
  login: cmdLogin,
  logout: cmdLogout,
  manifest: cmdManifest,
  npm: cmdNpm,
  npx: cmdNpx,
  pnpm: cmdPnpm,
  oops: cmdOops,
  optimize: cmdOptimize,
  organization: cmdOrganization,
  package: cmdPackage,
  patch: cmdPatch,
  'raw-npm': cmdRawNpm,
  'raw-npx': cmdRawNpx,
  repository: cmdRepository,
  scan: cmdScan,
  security: cmdOrganizationPolicySecurity,
  'threat-feed': cmdThreatFeed,
  uninstall: cmdUninstall,
  wrapper: cmdWrapper,
  yarn: cmdYarn,
}

export const rootAliases = {
  audit: {
    description: `${cmdAuditLog.description} (alias)`,
    hidden: false,
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
  ['audit-logs']: {
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
  org: {
    description: `${cmdOrganization.description} (alias)`,
    hidden: false,
    argv: ['organization'],
  },
  orgs: {
    description: cmdOrganization.description,
    hidden: true,
    argv: ['organization'],
  },
  organizations: {
    description: cmdOrganization.description,
    hidden: true,
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
  pkg: {
    description: `${cmdPackage.description} (alias)`,
    hidden: false,
    argv: ['package'],
  },
  repo: {
    description: `${cmdRepository.description} (alias)`,
    hidden: false,
    argv: ['repos'],
  },
  repos: {
    description: cmdRepository.description,
    hidden: true,
    argv: ['repos'],
  },
  repositories: {
    description: cmdRepository.description,
    hidden: true,
    argv: ['repos'],
  },
}
