import { processEnv } from '@socketsecurity/lib-stable/primordials/process'
import { MILLISECONDS_PER_SECOND } from '@socketsecurity/lib-stable/constants/time'
import { GIT_VALUE_FLAGS } from '../_shared/positional-args.mts'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { splitGitSubcommand } from '../_shared/git-subcommand.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { parseDryRunPaths } from '../no-self-referential-symlink-guard/index.mts'
import type { Command } from '../_shared/shell-command.mts'

const GIT_PROBE_TIMEOUT_MS = 5 * MILLISECONDS_PER_SECOND
const MAX_GIT_OUTPUT_BYTES = 1024 ** 2
const VALUE_FLAGS = new Set([
  ...GIT_VALUE_FLAGS,
  '--author',
  '--date',
  '--file',
  '--fixup',
  '--reedit-message',
  '--reuse-message',
  '--squash',
  '--template',
  '--trailer',
  '-F',
  '-t',
])

export function unsafeGitProbeFlags(
  args: readonly string[],
  sub: string,
): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--') {
      break
    }
    if (VALUE_FLAGS.has(arg)) {
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      const name = arg.split('=')[0]!
      if (
        [
          '--no-dry-run',
          '--interactive',
          '--patch',
          '--edit',
          '--pathspec-from-file',
        ].includes(name)
      ) {
        return true
      }
    } else if (arg.startsWith('-')) {
      for (let offset = 1; offset < arg.length; offset += 1) {
        const flag = `-${arg.slice(offset, offset + 1)}`
        if (VALUE_FLAGS.has(flag)) {
          if (offset === arg.length - 1) {
            index += 1
          }
          break
        }
        if (
          flag === '-p' ||
          flag === '-e' ||
          (sub === 'add' && flag === '-i')
        ) {
          return true
        }
      }
    }
  }
  return false
}

export function committedAdapterCandidates(output: string): string[] {
  const paths: string[] = []
  const rows = output.split('\0')
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const state = row.charCodeAt(0)
    if ('ACMRTU'.includes(row.slice(0, 1)) && row.length > 3) {
      paths.push(row.slice(3))
    }
    if (state === 82 /* 'R' */ || state === 67 /* 'C' */) {
      index += 1
    }
  }
  return paths
}

function gitProbeEnvironment(command: Command): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...processEnv(),
    GIT_OPTIONAL_LOCKS: '0',
  }
  for (const assignment of command.assignments) {
    const separator = assignment.indexOf('=')
    const name = assignment.slice(0, separator)
    if (['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE'].includes(name)) {
      environment[name] = assignment.slice(separator + 1)
    }
  }
  return environment
}

export function readGitAdapterCandidates(
  command: Command,
  cwd: string,
): string[] | undefined {
  const { sub, rest } = splitGitSubcommand(command.args)
  if (sub !== 'add' && sub !== 'commit') {
    return []
  }
  const verbIndex = command.args.length - rest.length - 1
  const separator = rest.indexOf('--')
  const flags = separator < 0 ? rest : rest.slice(0, separator)
  if (unsafeGitProbeFlags(flags, sub)) {
    return undefined
  }
  const args = [
    ...command.args.slice(0, verbIndex),
    '-c',
    'core.quotePath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.hooksPath=/dev/null',
    command.args[verbIndex]!,
    ...flags,
    '--dry-run',
    ...(sub === 'commit' ? ['--porcelain', '-z'] : []),
    ...(separator < 0 ? [] : rest.slice(separator)),
  ]
  let result
  try {
    result = spawnSync('git', args, {
      cwd,
      env: gitProbeEnvironment(command),
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: 'pipe',
      stdioString: true,
      timeout: spawnTimeoutMs(GIT_PROBE_TIMEOUT_MS),
      trim: false,
    })
  } catch {
    return undefined
  }
  if (result.status !== 0 && !(sub === 'commit' && result.status === 1)) {
    return undefined
  }
  return sub === 'add'
    ? parseDryRunPaths(String(result.stdout ?? ''))
    : committedAdapterCandidates(String(result.stdout ?? ''))
}
