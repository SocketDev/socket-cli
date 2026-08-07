/**
 * @file The `socket --describe [--json]` fast path: a one-line purpose, or a
 *   machine-readable manifest of the root command tree, answered before any
 *   side effect (telemetry, update checks, dispatch). The manifest shape is
 *   the fleet CLI self-description contract — MCP-aligned field names, the
 *   canonical JSON Schema in socket-wheelhouse under
 *   `schemas/cli-describe.schema.json` — and converges on
 *   `@socketsecurity/lib/argv/meta` once that module ships; until then the
 *   types live here so the CLI carries no unpublished import.
 */

import type { CliSubcommand } from './with-subcommands-shared.mts'

export interface CliFlagMeta {
  readonly default?: boolean | number | string | undefined
  readonly description: string
  readonly hidden?: boolean | undefined
  readonly name: string
  readonly short?: string | undefined
  readonly type: 'boolean' | 'number' | 'string'
}

export interface CliCommandMeta {
  readonly description: string
  readonly hidden?: boolean | undefined
  readonly name: string
}

export interface CliManifest {
  readonly $schema: string
  readonly commands: readonly CliCommandMeta[]
  readonly description: string
  readonly flags: readonly CliFlagMeta[]
  readonly name: string
  readonly version: string
}

const CLI_DESCRIBE_SCHEMA_URL =
  'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/schemas/cli-describe.schema.json'

const ROOT_DESCRIPTION =
  'CLI for Socket.dev — scan dependencies, audit packages, apply security patches, and gate installs'

/**
 * Build the root manifest from the live command registry, so a new command
 * appears here the moment it registers — no parallel list to drift. Hidden
 * commands are included: the manifest is the honest contract, unlike
 * `--help`, which curates.
 */
export function buildRootManifest(config: {
  name: string
  subcommands: Readonly<Record<string, CliSubcommand>>
  version: string
}): CliManifest {
  const { name, subcommands, version } = {
    __proto__: null,
    ...config,
  } as typeof config
  const commands = Object.entries(subcommands).map(
    ([commandName, subcommand]): CliCommandMeta =>
      subcommand.hidden
        ? {
            name: commandName,
            description: subcommand.description,
            hidden: true,
          }
        : { name: commandName, description: subcommand.description },
  )
  return {
    $schema: CLI_DESCRIBE_SCHEMA_URL,
    name,
    version,
    description: ROOT_DESCRIPTION,
    commands,
    flags: [
      {
        name: 'describe',
        type: 'boolean',
        default: false,
        description:
          'Print what this tool does and exit; with --json, a machine-readable command manifest',
      },
      {
        name: 'help',
        type: 'boolean',
        default: false,
        description: 'Show help',
      },
      {
        name: 'json',
        type: 'boolean',
        default: false,
        description: 'Output as JSON',
      },
      {
        name: 'version',
        type: 'boolean',
        default: false,
        description: 'Show version',
      },
    ],
  }
}

/**
 * The describe request found on argv, if any: `'json'` when `--json` rides
 * along, `'text'` for the bare flag, undefined when absent.
 */
export function describeRequest(
  argv: readonly string[],
): 'json' | 'text' | undefined {
  if (!argv.includes('--describe')) {
    return undefined
  }
  return argv.includes('--json') ? 'json' : 'text'
}

/**
 * The text a describe request prints: the one-liner for `'text'`, the
 * manifest JSON for `'json'`. The caller owns the write and the exit.
 */
export function renderDescribe(
  kind: 'json' | 'text',
  manifest: CliManifest,
): string {
  return kind === 'json'
    ? `${JSON.stringify(manifest, undefined, 2)}\n`
    : `${manifest.description}\n`
}
