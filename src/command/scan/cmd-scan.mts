import { cmdScanAgentConfigs } from './cmd-scan-agent-configs.mts'
import { cmdScanCreate } from './cmd-scan-create.mts'
import { cmdScanDel } from './cmd-scan-del.mts'
import { cmdScanDiff } from './cmd-scan-diff.mts'
import { cmdScanGithub } from './cmd-scan-github.mts'
import { cmdScanList } from './cmd-scan-list.mts'
import { cmdScanMetadata } from './cmd-scan-metadata.mts'
import { cmdScanManifests } from './cmd-scan-manifests.mts'
import { cmdScanReach } from './cmd-scan-reach.mts'
import { cmdScanReport } from './cmd-scan-report.mts'
import { cmdScanSecrets } from './cmd-scan-secrets.mts'
import { cmdScanSetup } from './cmd-scan-setup.mts'
import { cmdScanSkills } from './cmd-scan-skills.mts'
import { cmdScanView } from './cmd-scan-view.mts'
import { cmdScanWorkflows } from './cmd-scan-workflows.mts'
import { defineSubcommandGroup } from '../../util/cli/define-subcommand-group.mts'

export const cmdScan = defineSubcommandGroup({
  name: 'scan',
  description: 'Manage Socket scans',
  subcommands: {
    'agent-configs': cmdScanAgentConfigs,
    create: cmdScanCreate,
    del: cmdScanDel,
    diff: cmdScanDiff,
    github: cmdScanGithub,
    list: cmdScanList,
    manifests: cmdScanManifests,
    metadata: cmdScanMetadata,
    reach: cmdScanReach,
    report: cmdScanReport,
    secrets: cmdScanSecrets,
    setup: cmdScanSetup,
    skills: cmdScanSkills,
    view: cmdScanView,
    workflows: cmdScanWorkflows,
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
