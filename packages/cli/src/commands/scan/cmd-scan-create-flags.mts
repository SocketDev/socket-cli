/**
 * Flag schema for `socket scan create`.
 *
 * Extracted from cmd-scan-create.mts to keep that file under the
 * 1000-line File-size hard cap. Defining the (large) flag set here
 * lets the main command file focus on the run() orchestration logic.
 */

import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'

import type { MeowFlags } from '../../flags.mts'

export const generalFlags: MeowFlags = {
  ...commonFlags,
  ...outputFlags,
  autoManifest: {
    type: 'boolean',
    description:
      'Run `socket manifest auto` before collecting manifest files. This is necessary for languages like Scala, Gradle, and Kotlin, See `socket manifest auto --help`.',
  },
  basics: {
    type: 'boolean',
    default: false,
    description:
      'Run comprehensive security scanning (SAST, secrets, containers) via socket-basics. Requires Python, Trivy, TruffleHog, and OpenGrep to be available.',
  },
  branch: {
    type: 'string',
    default: '',
    description: 'Branch name',
    shortFlag: 'b',
  },
  commitHash: {
    type: 'string',
    default: '',
    description: 'Commit hash',
    shortFlag: 'ch',
  },
  commitMessage: {
    type: 'string',
    default: '',
    description: 'Commit message',
    shortFlag: 'm',
  },
  committers: {
    type: 'string',
    default: '',
    description: 'Committers',
    shortFlag: 'c',
  },
  cwd: {
    type: 'string',
    default: '',
    description: 'working directory, defaults to process.cwd()',
  },
  makeDefaultBranch: {
    type: 'boolean',
    default: false,
    description:
      'Reassign the repo\'s default-branch pointer at Socket to the branch of this scan. The previous default-branch designation is replaced. Mirrors the `make_default_branch` API field.',
  },
  // Deprecated alias for `--make-default-branch`. Declared as its own
  // boolean flag (rather than via meow `aliases`) because meow's alias
  // forwarding doesn't reliably propagate values in this command's
  // large flag set. We merge it onto `makeDefaultBranch` after parsing.
  defaultBranch: {
    type: 'boolean',
    default: false,
    description:
      'Deprecated alias for --make-default-branch. Kept working for back-compat; emits a deprecation warning on use.',
    hidden: true,
  },
  interactive: {
    type: 'boolean',
    default: true,
    description:
      'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
  },
  pullRequest: {
    type: 'number',
    default: 0,
    description: 'Pull request number',
    shortFlag: 'pr',
  },
  org: {
    type: 'string',
    default: '',
    description:
      'Force override the organization slug, overrides the default org from config',
  },
  reach: {
    type: 'boolean',
    default: false,
    description: 'Run tier 1 full application reachability analysis',
  },
  readOnly: {
    type: 'boolean',
    default: false,
    description:
      'Similar to --dry-run except it can read from remote, stops before it would create an actual report',
  },
  repo: {
    type: 'string',
    shortFlag: 'r',
    description: 'Repository name',
  },
  report: {
    type: 'boolean',
    description:
      'Wait for the scan creation to complete, then basically run `socket scan report` on it',
  },
  reportLevel: {
    type: 'string',
    default: constants.REPORT_LEVEL_ERROR,
    description: `Which policy level alerts should be reported (default '${constants.REPORT_LEVEL_ERROR}')`,
  },
  setAsAlertsPage: {
    type: 'boolean',
    default: true,
    description:
      'When true and if this is the "default branch" then this Scan will be the one reflected on your alerts page. See help for details. Defaults to true.',
    aliases: ['pendingHead'],
  },
  tmp: {
    type: 'boolean',
    default: false,
    description:
      'Set the visibility (true/false) of the scan in your dashboard.',
    shortFlag: 't',
  },
  workspace: {
    type: 'string',
    default: '',
    description:
      'The workspace in the Socket Organization that the repository is in to associate with the full scan.',
  },
}
