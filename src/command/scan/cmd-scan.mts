import { cmdScanCreate } from './cmd-scan-create.mts'
import { cmdScanDel } from './cmd-scan-del.mts'
import { cmdScanDiff } from './cmd-scan-diff.mts'
import { cmdScanGithub } from './cmd-scan-github.mts'
import { cmdScanList } from './cmd-scan-list.mts'
import { cmdScanMetadata } from './cmd-scan-metadata.mts'
import { cmdScanReach } from './cmd-scan-reach.mts'
import { cmdScanReport } from './cmd-scan-report.mts'
import { cmdScanSetup } from './cmd-scan-setup.mts'
import { cmdScanView } from './cmd-scan-view.mts'
import { defineSubcommandGroup } from '../../util/cli/define-subcommand-group.mts'

export const cmdScan = defineSubcommandGroup({
  name: 'scan',
  description: 'Manage Socket scans',
  subcommands: {
    create: cmdScanCreate,
    del: cmdScanDel,
    diff: cmdScanDiff,
    github: cmdScanGithub,
    list: cmdScanList,
    metadata: cmdScanMetadata,
    reach: cmdScanReach,
    report: cmdScanReport,
    setup: cmdScanSetup,
    view: cmdScanView,
  },
  aliases: {
    meta: {
      description: cmdScanMetadata.description,
      hidden: true,
      argv: ['metadata'],
    },
    reachability: {
      description: cmdScanReach.description,
      hidden: true,
      argv: ['reach'],
    },
  },
})
