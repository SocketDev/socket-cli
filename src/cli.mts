#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url'

import { messageWithCauses, stackWithCauses } from 'pony-cause'
import updateNotifier from 'tiny-updater'

import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { cmdAnalytics } from './commands/analytics/cmd-analytics.mts'
import { cmdAuditLog } from './commands/audit-log/cmd-audit-log.mts'
import { cmdCdxgen } from './commands/cdxgen/cmd-cdxgen.mts'
import { cmdCI } from './commands/ci/cmd-ci.mts'
import { cmdConfig } from './commands/config/cmd-config.mts'
import { cmdScanCreate } from './commands/dependencies/cmd-dependencies.mts'
import { cmdDiffScan } from './commands/diff-scan/cmd-diff-scan.mts'
import { cmdFix } from './commands/fix/cmd-fix.mts'
import { cmdInfo } from './commands/info/cmd-info.mts'
import { cmdInstall } from './commands/install/cmd-install.mts'
import { cmdJson } from './commands/json/cmd-json.mts'
import { cmdLogin } from './commands/login/cmd-login.mts'
import { cmdLogout } from './commands/logout/cmd-logout.mts'
import { cmdManifest } from './commands/manifest/cmd-manifest.mts'
import { cmdNpm } from './commands/npm/cmd-npm.mts'
import { cmdNpx } from './commands/npx/cmd-npx.mts'
import { cmdOops } from './commands/oops/cmd-oops.mts'
import { cmdOptimize } from './commands/optimize/cmd-optimize.mts'
import { cmdOrganizationPolicyLicense } from './commands/organization/cmd-organization-policy-license.mts'
import { cmdOrganizationPolicyPolicy } from './commands/organization/cmd-organization-policy-security.mts'
import { cmdOrganization } from './commands/organization/cmd-organization.mts'
import { cmdPackage } from './commands/package/cmd-package.mts'
import { cmdRawNpm } from './commands/raw-npm/cmd-raw-npm.mts'
import { cmdRawNpx } from './commands/raw-npx/cmd-raw-npx.mts'
import { cmdReport } from './commands/report/cmd-report.mts'
import { cmdRepos } from './commands/repos/cmd-repos.mts'
import { cmdScan } from './commands/scan/cmd-scan.mts'
import { cmdThreatFeed } from './commands/threat-feed/cmd-threat-feed.mts'
import { cmdUninstall } from './commands/uninstall/cmd-uninstall.mts'
import { cmdWrapper } from './commands/wrapper/cmd-wrapper.mts'
import constants from './constants.mts'
import { AuthError, InputError, captureException } from './utils/errors.mts'
import { failMsgWithBadge } from './utils/fail-msg-with-badge.mts'
import { meowWithSubcommands } from './utils/meow-with-subcommands.mts'

const __filename = fileURLToPath(import.meta.url)

const { SOCKET_CLI_BIN_NAME } = constants

// TODO: Add autocompletion using https://socket.dev/npm/package/omelette
void (async () => {
  await updateNotifier({
    name: SOCKET_CLI_BIN_NAME,
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION.
    version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    ttl: 86_400_000 /* 24 hours in milliseconds */,
  })

  try {
    await meowWithSubcommands(
      {
        ci: cmdCI,
        cdxgen: cmdCdxgen,
        config: cmdConfig,
        fix: cmdFix,
        info: cmdInfo,
        install: cmdInstall,
        json: cmdJson,
        login: cmdLogin,
        logout: cmdLogout,
        npm: cmdNpm,
        npx: cmdNpx,
        oops: cmdOops,
        optimize: cmdOptimize,
        organization: cmdOrganization,
        package: cmdPackage,
        'raw-npm': cmdRawNpm,
        'raw-npx': cmdRawNpx,
        report: cmdReport,
        wrapper: cmdWrapper,
        scan: cmdScan,
        'audit-log': cmdAuditLog,
        repos: cmdRepos,
        dependencies: cmdScanCreate,
        analytics: cmdAnalytics,
        'diff-scan': cmdDiffScan,
        'threat-feed': cmdThreatFeed,
        manifest: cmdManifest,
        uninstall: cmdUninstall,
      },
      {
        aliases: {
          audit: {
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
            description: cmdScanCreate.description,
            hidden: true,
            argv: ['dependencies'],
          },
          feed: {
            description: cmdThreatFeed.description,
            hidden: true,
            argv: ['threat-feed'],
          },
          license: {
            description: cmdOrganizationPolicyLicense.description,
            hidden: true,
            argv: ['organization', 'policy', 'license'],
          },
          org: {
            description: cmdOrganization.description,
            hidden: true,
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
            description: cmdPackage.description,
            hidden: true,
            argv: ['package'],
          },
          repo: {
            description: cmdRepos.description,
            hidden: true,
            argv: ['repos'],
          },
          repository: {
            description: cmdRepos.description,
            hidden: true,
            argv: ['repos'],
          },
          repositories: {
            description: cmdRepos.description,
            hidden: true,
            argv: ['repos'],
          },
          security: {
            description: cmdOrganizationPolicyPolicy.description,
            hidden: true,
            argv: ['organization', 'policy', 'security'],
          },
        },
        argv: process.argv.slice(2),
        name: SOCKET_CLI_BIN_NAME,
        importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta,
      },
    )
  } catch (e) {
    process.exitCode = 1
    let errorBody: string | undefined
    let errorTitle: string
    let errorMessage = ''
    if (e instanceof AuthError) {
      errorTitle = 'Authentication error'
      errorMessage = e.message
    } else if (e instanceof InputError) {
      errorTitle = 'Invalid input'
      errorMessage = e.message
      errorBody = e.body
    } else if (e instanceof Error) {
      errorTitle = 'Unexpected error'
      errorMessage = messageWithCauses(e)
      errorBody = stackWithCauses(e)
    } else {
      errorTitle = 'Unexpected error with no details'
    }
    logger.error('\n') // Any-spinner-newline
    logger.fail(failMsgWithBadge(errorTitle, errorMessage))
    if (errorBody) {
      // Explicitly use debugLog here.
      debugLog(errorBody)
    }
    await captureException(e)
  }
})()
