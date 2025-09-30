/** @fileoverview Script to fix TS4111 errors by converting ENV.property to ENV['property']. */

import { readFile, writeFile } from 'node:fs/promises'

const files = [
  'src/cli.mts',
  'src/commands/audit-log/output-audit-log.mts',
  'src/commands/ci/fetch-default-org-slug.mts',
  'src/commands/fix/env-helpers.mts',
  'src/commands/install/setup-tab-completion.mts',
  'src/commands/json/output-cmd-json.mts',
  'src/commands/scan/cmd-scan-github.mts',
  'src/commands/scan/setup-scan-config.mts',
  'src/commands/self-update/handle-self-update.mts',
  'src/commands/whoami/handle-whoami.mts',
  'src/constants.mts',
  'src/flags.mts',
  'src/instrument-with-sentry.mts',
  'src/shadow/npm-base.mts',
  'src/shadow/npm/arborist/lib/arborist/index.mts',
  'src/shadow/npm/install.mts',
  'src/shadow/pnpm/bin.mts',
  'src/shadow/yarn/bin.mts',
  'src/utils/api.mts',
  'src/utils/dlx-detection.mts',
  'src/utils/dlx.mts',
  'src/utils/git.mts',
  'src/utils/github.mts',
  'src/utils/meow-with-subcommands.mts',
  'src/utils/npm-paths.mts',
  'src/utils/package-environment.mts',
  'src/utils/sdk.mts',
]

const properties = [
  'CI',
  'content',
  'DISABLE_GITHUB_CACHE',
  'GITHUB_API_URL',
  'INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION',
  'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION',
  'INLINED_SOCKET_CLI_HOMEPAGE',
  'INLINED_SOCKET_CLI_NAME',
  'INLINED_SOCKET_CLI_PUBLISHED_BUILD',
  'INLINED_SOCKET_CLI_SENTRY_BUILD',
  'INLINED_SOCKET_CLI_SYNP_VERSION',
  'INLINED_SOCKET_CLI_VERSION',
  'INLINED_SOCKET_CLI_VERSION_HASH',
  'LOCALAPPDATA',
  'NODE_ENV',
  'NODE_OPTIONS',
  'npm_config_cache',
  'npm_config_user_agent',
  'SOCKET_CLI_ACCEPT_RISKS',
  'SOCKET_CLI_API_BASE_URL',
  'SOCKET_CLI_API_PROXY',
  'SOCKET_CLI_API_TIMEOUT',
  'SOCKET_CLI_API_TOKEN',
  'SOCKET_CLI_COANA_LOCAL_PATH',
  'SOCKET_CLI_CONFIG',
  'SOCKET_CLI_DEBUG',
  'SOCKET_CLI_GIT_USER_EMAIL',
  'SOCKET_CLI_GIT_USER_NAME',
  'SOCKET_CLI_GITHUB_TOKEN',
  'SOCKET_CLI_NO_API_TOKEN',
  'SOCKET_CLI_NPM_PATH',
  'SOCKET_CLI_ORG_SLUG',
  'SOCKET_CLI_VIEW_ALL_RISKS',
  'VITEST',
  'XDG_DATA_HOME',
]

let totalChanges = 0

for (const file of files) {
  // eslint-disable-next-line no-await-in-loop
  let content = await readFile(file, 'utf8')
  let changed = false
  let fileChanges = 0

  for (const prop of properties) {
    // Match patterns like:
    // ENV.PROPERTY or constants.ENV.PROPERTY or otherVar.ENV.PROPERTY
    // But not inside strings or comments
    const regex = new RegExp(`\\b(\\w+\\.)?ENV\\.${prop}\\b`, 'g')
    const newContent = content.replace(regex, (match, prefix) => {
      fileChanges++
      return `${prefix || ''}ENV['${prop}']`
    })

    if (newContent !== content) {
      content = newContent
      changed = true
    }
  }

  if (changed) {
    // eslint-disable-next-line no-await-in-loop
    await writeFile(file, content, 'utf8')
    console.log(`Fixed ${fileChanges} references in ${file}`)
    totalChanges += fileChanges
  }
}

console.log(`\nTotal changes: ${totalChanges}`)
