import { MILLISECONDS_PER_SECOND } from '@socketsecurity/lib-stable/constants/time'
import { parseJsonStrict } from '@socketsecurity/lib-stable/json/parse'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import ciSecrets from '../../../github/ci/secrets.json' with { type: 'json' }

const MAX_RESPONSE_BYTES = 1024 ** 2

export interface RemoteCiVariableCommand {
  args: readonly string[]
  input?: string | undefined
}

export type RemoteCiVariableRunner = (command: RemoteCiVariableCommand) => {
  status: number | null
  stdout: string
}

export function runRemoteCiVariableCommand(command: RemoteCiVariableCommand) {
  const result = spawnSync('gh', command.args, {
    input: command.input,
    maxBuffer: MAX_RESPONSE_BYTES,
    shell: false,
    stdio: 'pipe',
    stdioString: true,
    timeout: 30 * MILLISECONDS_PER_SECOND,
  })
  return { __proto__: null, status: result.status, stdout: result.stdout }
}

function readRemoteCiNames(stdout: string): string[] {
  const rows = parseJsonStrict(stdout)
  if (!Array.isArray(rows)) {
    throw new Error('Invalid metadata collection')
  }
  return rows.map((row: unknown) => {
    if (
      row === null ||
      typeof row !== 'object' ||
      !('name' in row) ||
      typeof row.name !== 'string'
    ) {
      throw new Error('Invalid metadata entry')
    }
    return row.name
  })
}

function readRemoteCiVariableValue(stdout: string, name: string): string {
  const document = parseJsonStrict(stdout)
  if (
    document === null ||
    typeof document !== 'object' ||
    !('name' in document) ||
    document.name !== name ||
    !('value' in document) ||
    typeof document.value !== 'string' ||
    document.value.length === 0
  ) {
    throw new Error('Invalid variable value')
  }
  return document.value
}

function validateRemoteCiMigrationRequest(config: {
  repository: string
  name: string
  source: string
}) {
  const { repository, name, source } = config
  if (
    !/^[\w-]+\/[\w.-]+$/.test(repository) ||
    repository.endsWith('/.') ||
    repository.endsWith('/..') ||
    !['repository', 'organization'].includes(source) ||
    !ciSecrets.secrets.some(secret => secret.name === name)
  ) {
    throw new Error('Invalid migration request')
  }
}

export function migrateRemoteCiVariable(config: {
  repository: string
  name: string
  source?: 'repository' | 'organization' | undefined
  run?: RemoteCiVariableRunner | undefined
}): {
  name: string
  status: 'absent' | 'retained' | 'migrated' | 'copied'
  organizationVariableRetained?: boolean | undefined
} {
  const {
    repository,
    name,
    source = 'repository',
    run = runRemoteCiVariableCommand,
  } = config
  const targetRepository = `github.com/${repository}`
  let stage = 'validate request'
  try {
    validateRemoteCiMigrationRequest({ repository, name, source })
    function execute(args: string[], input?: string | undefined): string {
      const result = run({ args, ...(input === undefined ? {} : { input }) })
      if (result.status !== 0) {
        throw new Error('GitHub command failed')
      }
      return result.stdout
    }
    function listNames(kind: 'secret' | 'variable'): string[] {
      return readRemoteCiNames(
        execute([kind, 'list', '--repo', targetRepository, '--json', 'name']),
      )
    }
    function readOrganization(kind: 'secrets' | 'variables', query: string) {
      return execute([
        'api',
        '--hostname',
        'github.com',
        '--paginate',
        `repos/${repository}/actions/organization-${kind}?per_page=100`,
        '--jq',
        query,
      ])
    }
    function listOrganizationNames(kind: 'secrets' | 'variables') {
      return readOrganization(kind, `.${kind} | map({name}) | tojson`)
        .trim()
        .split(/\r?\n/)
        .flatMap(readRemoteCiNames)
    }
    stage = 'read variable names'
    const variableNames =
      source === 'organization'
        ? listOrganizationNames('variables')
        : listNames('variable')
    if (!variableNames.includes(name)) {
      return { name, status: 'absent' }
    }
    stage = 'read secret names'
    const retained = listNames('secret').includes(name)
    if (source === 'organization') {
      stage = 'read inherited secret names'
      if (retained || listOrganizationNames('secrets').includes(name)) {
        return { name, status: 'retained', organizationVariableRetained: true }
      }
    }
    if (!retained) {
      stage = 'read variable'
      const value = readRemoteCiVariableValue(
        source === 'organization'
          ? readOrganization(
              'variables',
              `.variables[] | select(.name == "${name}") | {name, value} | tojson`,
            )
          : execute([
              'api',
              '--hostname',
              'github.com',
              `repos/${repository}/actions/variables/${name}`,
            ]),
        name,
      )
      stage = 'store secret'
      execute(['secret', 'set', name, '--repo', targetRepository], value)
    }
    stage = 'verify secret'
    if (!listNames('secret').includes(name)) {
      throw new Error('Secret is not present')
    }
    if (source === 'organization') {
      return { name, status: 'copied', organizationVariableRetained: true }
    }
    stage = 'remove variable'
    execute(['variable', 'delete', name, '--repo', targetRepository])
    stage = 'verify variable removal'
    if (listNames('variable').includes(name)) {
      throw new Error('Variable is still present')
    }
    return { name, status: retained ? 'retained' : 'migrated' }
  } catch {
    throw Object.assign(
      new Error(
        `Remote CI variable migration failed. Where: ${stage}. Saw an unsuccessful or invalid response; wanted verified secret storage. Fix: check repository access and retry.`,
      ),
      { code: 'ERR_REMOTE_CI_VARIABLE_MIGRATION', stage },
    )
  }
}
