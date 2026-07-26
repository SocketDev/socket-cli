/**
 * @file CLI argument parsing for the fleet test runner
 *   (scripts/fleet/test.mts): the `--lane` speed selector and the
 *   `--shard=<index>/<count>` partition flag. Pure — takes argv, returns parsed
 *   values, throws on malformed input.
 */

// Test LANES — a SPEED category orthogonal to scope. `--lane fast|mid|slow`
// runs that lane (membership from `vitest.lanes` in the settings file); bare
// `pnpm test` defaults to the fast lane. See .config/repo/vitest.config.mts.
export const VALID_LANES: ReadonlySet<string> = new Set(['fast', 'mid', 'slow'])

// Pull the `--lane <value>` / `--lane=<value>` flag out of argv and return the
// rest, so the scope/shard parsers never mistake the lane value for a file.
export function extractLane(argv: readonly string[]): {
  lane: string | undefined
  rest: string[]
} {
  const rest: string[] = []
  let lane: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    let value: string | undefined
    if (arg === '--lane') {
      i += 1
      value = argv[i]
    } else if (arg.startsWith('--lane=')) {
      value = arg.slice('--lane='.length)
    } else {
      rest.push(arg)
      continue
    }
    if (!value || !VALID_LANES.has(value)) {
      throw new Error(
        'Invalid --lane value.\n' +
          '  Where: scripts/fleet/test.mts CLI argument parsing.\n' +
          `  Saw: ${value ?? '(missing value)'}; wanted one of fast | mid | slow.\n` +
          '  Fix: pass --lane fast (the bare `pnpm test` default), --lane mid, or --lane slow.',
      )
    }
    lane = value
  }
  return { lane, rest }
}

export interface ParsedTestRunnerArgs {
  files: string[]
  shard: string | undefined
}

export function parseTestRunnerArgs(
  argv: readonly string[],
): ParsedTestRunnerArgs {
  const files: string[] = []
  let shard: string | undefined

  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    let candidate: string | undefined
    if (arg === '--shard') {
      i += 1
      candidate = argv[i]
    } else if (arg.startsWith('--shard=')) {
      candidate = arg.slice('--shard='.length)
    } else if (!arg.startsWith('-')) {
      files.push(arg)
      continue
    } else {
      continue
    }

    const match = /^(?<index>[1-9]\d*)\/(?<count>[1-9]\d*)$/.exec(
      candidate ?? '',
    )
    if (
      !match?.groups ||
      Number(match.groups['index']) > Number(match.groups['count']) ||
      shard !== undefined
    ) {
      throw new Error(
        'Invalid test shard argument.\n' +
          'Where: scripts/fleet/test.mts CLI argument parsing.\n' +
          `Saw: ${candidate ?? '(missing value)'}; wanted one --shard=<index>/<count> with 1 <= index <= count.\n` +
          'Fix: pass a single shard such as --shard=1/4 alongside --all.',
      )
    }
    shard = candidate
  }

  return { files, shard }
}
